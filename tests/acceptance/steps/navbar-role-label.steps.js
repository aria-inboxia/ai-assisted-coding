import { createBdd } from "playwright-bdd";
import { test, expect } from "../fixtures.js";
import { HomePage } from "../pages/HomePage.js";

const { Then } = createBdd(test);

Then("the navbar shows the admin role label", async ({ page }) => {
  const home = new HomePage(page);
  await expect(home.navbarRole).toBeVisible();
  await expect(home.navbarRole).toHaveText("admin");
});

Then("the navbar shows the user role label", async ({ page }) => {
  const home = new HomePage(page);
  await expect(home.navbarRole).toBeVisible();
  await expect(home.navbarRole).toHaveText("user");
});
