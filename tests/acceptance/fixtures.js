import { test as base } from "playwright-bdd";

const ADMIN = { email: "admin@foyer.local", role: "admin" };
const REGULAR = { email: "user@foyer.local", role: "user" };

function pickSession(tags) {
  if (tags.includes("@manualLogin")) return null;
  if (tags.includes("@userLogin")) return REGULAR;
  return ADMIN;
}

export const test = base.extend({
  state: async ({}, use) => {
    await use({});
  },
  page: async ({ page }, use, testInfo) => {
    const session = pickSession(testInfo.tags ?? []);

    await page.goto("/");
    await page.evaluate((s) => {
      localStorage.clear();
      if (s) localStorage.setItem("foyer.session", JSON.stringify(s));
    }, session);

    if (session) {
      await page.goto("/");
    }

    await use(page);
  },
});

export { expect } from "@playwright/test";
