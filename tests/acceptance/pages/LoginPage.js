export class LoginPage {
  constructor(page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: /sign in to foyer/i });
    this.email = page.getByLabel(/email/i);
    this.password = page.getByLabel(/password/i);
    this.submit = page.getByRole("button", { name: /continue/i });
    this.error = page.getByRole("alert");
  }

  async waitFor() {
    await this.heading.waitFor({ state: "visible" });
  }

  async signIn(email, password) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
