export class HomePage {
  constructor(page) {
    this.page = page;
    this.banner = page.locator(".banner");
    this.bannerMessage = page.locator(".banner__message");
    this.greeting = page.getByRole("heading", { name: /^hi /i });
    this.signOutButton = page.getByRole("button", { name: /sign out/i });
    this.navbarRole = page.locator(".navbar__role");
  }

  async waitFor() {
    await this.banner.waitFor({ state: "visible" });
  }

  async getMessage() {
    return this.bannerMessage.innerText();
  }

  async getAccent() {
    const cls = (await this.banner.getAttribute("class")) ?? "";
    const match = cls.match(/banner--accent-([a-z]+)/);
    return match ? match[1] : null;
  }

  async greetingText() {
    return this.greeting.innerText();
  }

  async signOut() {
    await this.signOutButton.click();
  }
}
