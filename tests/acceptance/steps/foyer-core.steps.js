import { createBdd } from "playwright-bdd";
import { test, expect } from "../fixtures.js";
import { HomePage } from "../pages/HomePage.js";
import { LoginPage } from "../pages/LoginPage.js";

const { Given, When, Then } = createBdd(test);

const VALID = { email: "admin@foyer.local", password: "admin" };
const INVALID = { email: "stranger@foyer.local", password: "nope" };

// Step texts are defined exactly once: playwright-bdd matches steps
// keyword-agnostically, so the same text under both Given and Then would be a
// duplicate definition. "I am on the home page" / "I am on the sign-in screen"
// each serve as both precondition and assertion.

Given("I am on the sign-in screen", async ({ page }) => {
  const login = new LoginPage(page);
  await login.waitFor();
});

Given("I am on the home page", async ({ page }) => {
  const home = new HomePage(page);
  await home.waitFor();
});

When("I sign in with valid credentials", async ({ page }) => {
  const login = new LoginPage(page);
  await login.signIn(VALID.email, VALID.password);
});

When("I sign in with invalid credentials", async ({ page }) => {
  const login = new LoginPage(page);
  await login.signIn(INVALID.email, INVALID.password);
});

When("I sign out", async ({ page }) => {
  const home = new HomePage(page);
  await home.signOut();
});

Then("I see a sign-in error", async ({ page }) => {
  const login = new LoginPage(page);
  await expect(login.error).toBeVisible();
});

Then("I am still on the sign-in screen", async ({ page }) => {
  const login = new LoginPage(page);
  await expect(login.heading).toBeVisible();
});

Then("the welcome banner shows the default message", async ({ page }) => {
  const home = new HomePage(page);
  expect(await home.getMessage()).toBe("Welcome to Foyer");
});

Then("the home page greets me by my email name", async ({ page }) => {
  const home = new HomePage(page);
  const text = (await home.greetingText()).toLowerCase();
  expect(text).toContain("hi admin");
});
