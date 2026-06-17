import { describe, it, expect } from "vitest";
import {
  parseRequirements,
  parseFeature,
  parseResults,
  buildMatrix,
  renderYaml,
  renderMarkdown,
  findViolations,
  augmentMatrix,
} from "./trace.js";

describe("parseRequirements", () => {
  it("parses bullets, strips a trailing period, and joins wrapped lines", () => {
    const md = [
      "## Requirements",
      "",
      "- **R.1** — First requirement.",
      "- **R.2** — Second requirement that",
      "  wraps across two lines",
      "",
      "## Out of scope",
      "- not a requirement",
    ].join("\n");
    expect(parseRequirements(md)).toEqual([
      { id: "R.1", summary: "First requirement" },
      { id: "R.2", summary: "Second requirement that wraps across two lines" },
    ]);
  });

  it("accepts hyphen and en-dash, and captures an empty summary", () => {
    const md = [
      "- **R.1** - hyphen separated",
      "- **R.2** – en-dash separated",
      "- **R.3** —   ",
    ].join("\n");
    expect(parseRequirements(md)).toEqual([
      { id: "R.1", summary: "hyphen separated" },
      { id: "R.2", summary: "en-dash separated" },
      { id: "R.3", summary: "" },
    ]);
  });
});

describe("parseFeature", () => {
  it("extracts scenarios with their @R.N requirement tags", () => {
    const feature = [
      "Feature: Demo",
      "  @adminLogin @R.1",
      "  Scenario: Alpha",
      "    Given x",
      "  @R.2 @R.3",
      "  Scenario: Beta",
      "    Given y",
    ].join("\n");
    expect(parseFeature(feature, "demo.feature")).toEqual([
      { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
      { feature: "demo.feature", scenario: "Beta", reqTags: ["R.2", "R.3"] },
    ]);
  });
});

describe("parseResults", () => {
  it("flattens nested suites, derives feature, and marks pass by outcome", () => {
    const report = {
      suites: [
        {
          file: "tests/foo.feature.spec.js",
          specs: [
            {
              title: "Alpha",
              tags: ["adminLogin", "R.1"],
              tests: [{ status: "expected" }],
            },
            { title: "Flaky", tags: ["R.2"], tests: [{ status: "flaky" }] },
            { title: "Bad", tags: ["R.3"], tests: [{ status: "unexpected" }] },
          ],
        },
      ],
    };
    expect(parseResults(report)).toEqual([
      {
        scenario: "Alpha",
        feature: "foo.feature",
        tags: ["adminLogin", "R.1"],
        passed: true,
      },
      {
        scenario: "Flaky",
        feature: "foo.feature",
        tags: ["R.2"],
        passed: true,
      },
      { scenario: "Bad", feature: "foo.feature", tags: ["R.3"], passed: false },
    ]);
  });

  it("maps Scenario Outline 'Example #N' rows back to the outline scenario name", () => {
    const report = {
      suites: [
        {
          file: "tests/login.feature.spec.js",
          suites: [
            {
              title: "Admin logs in",
              specs: [
                {
                  title: "Example #1",
                  tags: ["R.1"],
                  tests: [{ status: "expected" }],
                },
                {
                  title: "Example #2",
                  tags: ["R.1"],
                  tests: [{ status: "expected" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseResults(report)).toEqual([
      {
        scenario: "Admin logs in",
        feature: "login.feature",
        tags: ["R.1"],
        passed: true,
      },
      {
        scenario: "Admin logs in",
        feature: "login.feature",
        tags: ["R.1"],
        passed: true,
      },
    ]);
  });
});

const SPECS = [
  {
    id: "demo",
    source: "docs/specs/demo.md",
    requirements: [
      { id: "R.1", summary: "Alpha works" },
      { id: "R.2", summary: "Beta works" },
    ],
  },
];

describe("buildMatrix", () => {
  it("links each requirement to the scenarios tagged with it", () => {
    const scenarios = [
      { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
    ];
    const matrix = buildMatrix(SPECS, scenarios);
    expect(matrix.specs[0].requirements[0].scenarios).toEqual([
      { feature: "demo.feature", scenario: "Alpha", status: "covered" },
    ]);
    expect(matrix.specs[0].requirements[1].scenarios).toEqual([]);
  });
});

describe("findViolations", () => {
  const scenarios = [
    { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
  ];
  const matrix = buildMatrix(SPECS, scenarios);

  it("flags an uncovered requirement", () => {
    const v = findViolations(matrix, scenarios);
    expect(v.some((x) => x.startsWith("UNCOVERED R.2"))).toBe(true);
    expect(v.some((x) => x.startsWith("UNCOVERED R.1"))).toBe(false);
  });

  it("flags an orphan @R.N tag", () => {
    const orphanScenarios = [
      ...scenarios,
      { feature: "demo.feature", scenario: "Ghost", reqTags: ["R.9"] },
    ];
    const v = findViolations(matrix, orphanScenarios);
    expect(v.some((x) => x.startsWith("ORPHAN @R.9"))).toBe(true);
  });

  it("flags a requirement with an empty summary", () => {
    const badSpecs = [
      {
        id: "demo",
        source: "d.md",
        requirements: [{ id: "R.1", summary: "" }],
      },
    ];
    const m = buildMatrix(badSpecs, [
      { feature: "d.feature", scenario: "A", reqTags: ["R.1"] },
    ]);
    expect(
      findViolations(m, []).some((x) => x.startsWith("MALFORMED R.1")),
    ).toBe(true);
  });

  it("does not let a same-titled passing scenario in another feature mask a failure", () => {
    const specs = [
      {
        id: "s",
        source: "s.md",
        requirements: [{ id: "R.1", summary: "login" }],
      },
    ];
    const scen = [
      { feature: "a.feature", scenario: "Login", reqTags: ["R.1"] },
      { feature: "b.feature", scenario: "Login", reqTags: ["R.1"] },
    ];
    const m = buildMatrix(specs, scen);
    const results = [
      { scenario: "Login", feature: "a.feature", tags: ["R.1"], passed: true },
      { scenario: "Login", feature: "b.feature", tags: ["R.1"], passed: false },
    ];
    const v = findViolations(m, scen, results);
    expect(
      v.some((x) => x.startsWith("UNPROVEN R.1") && x.includes("b.feature")),
    ).toBe(true);
    expect(
      v.some((x) => x.startsWith("UNPROVEN R.1") && x.includes("a.feature")),
    ).toBe(false);
  });

  it("passes clean when everything is covered and passing", () => {
    const fullMatrix = buildMatrix(SPECS, [
      { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
      { feature: "demo.feature", scenario: "Beta", reqTags: ["R.2"] },
    ]);
    const allScenarios = [
      { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
      { feature: "demo.feature", scenario: "Beta", reqTags: ["R.2"] },
    ];
    const results = [
      {
        scenario: "Alpha",
        feature: "demo.feature",
        tags: ["R.1"],
        passed: true,
      },
      {
        scenario: "Beta",
        feature: "demo.feature",
        tags: ["R.2"],
        passed: true,
      },
    ];
    expect(findViolations(fullMatrix, allScenarios, results)).toEqual([]);
  });
});

describe("augmentMatrix", () => {
  const matrix = buildMatrix(SPECS, [
    { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
  ]);
  const scenarioOf = (m) => m.specs[0].requirements[0].scenarios[0];

  it("marks passed=null when no results are supplied", () => {
    expect(scenarioOf(augmentMatrix(matrix, null)).passed).toBe(null);
  });

  it("marks passed=true when a matching result passed", () => {
    const results = [
      {
        scenario: "Alpha",
        feature: "demo.feature",
        tags: ["R.1"],
        passed: true,
      },
    ];
    expect(scenarioOf(augmentMatrix(matrix, results)).passed).toBe(true);
  });

  it("marks passed=false when no result matches or the feature differs", () => {
    expect(scenarioOf(augmentMatrix(matrix, [])).passed).toBe(false);
    const wrongFeature = [
      {
        scenario: "Alpha",
        feature: "other.feature",
        tags: ["R.1"],
        passed: true,
      },
    ];
    expect(scenarioOf(augmentMatrix(matrix, wrongFeature)).passed).toBe(false);
  });
});

describe("rendering", () => {
  const scenarios = [
    { feature: "demo.feature", scenario: "Alpha", reqTags: ["R.1"] },
  ];
  const matrix = buildMatrix(SPECS, scenarios);

  it("renders deterministic YAML with quoted free-text scalars", () => {
    const yaml = renderYaml(matrix);
    expect(yaml).toContain("  - id: demo");
    expect(yaml).toContain("      - id: R.1");
    expect(yaml).toContain("        summary: 'Alpha works'");
    expect(yaml).toContain("            scenario: 'Alpha'");
    expect(yaml).toContain("        scenarios: []"); // R.2 uncovered
    expect(yaml.endsWith("\n")).toBe(true);
  });

  it("renders a Markdown coverage summary", () => {
    const md = renderMarkdown(matrix);
    expect(md).toContain("**1 of 2** requirements covered");
    expect(md).toContain("`demo.feature` › Alpha");
    expect(md).toContain("| R.2 | Beta works | — none — |");
  });
});
