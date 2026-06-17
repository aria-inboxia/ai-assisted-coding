import { createBdd } from "playwright-bdd";
import { test, expect } from "../fixtures.js";
import { HomePage } from "../pages/HomePage.js";

const { Then } = createBdd(test);

Then("the navbar shows the {word} role label", async ({ page }, role) => {
  const home = new HomePage(page);
  await expect(home.navbarRole).toBeVisible();
  await expect(home.navbarRole).toHaveText(role);
});
