import { expect, Page } from "@playwright/test";
import { RoleCredentials } from "./env";

export async function login(page: Page, credentials: RoleCredentials) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email-input").fill(credentials.email);
  await page.getByTestId("login-password-input").fill(credentials.password);
  await page.getByTestId("login-submit-button").click();

  const mainContent = page.getByTestId("main-content");
  const loginError = page.getByTestId("login-error");
  await expect(mainContent.or(loginError)).toBeVisible({ timeout: 30000 });

  if (await loginError.isVisible().catch(() => false)) {
    throw new Error(`Login gagal: ${await loginError.textContent()}`);
  }

  await expect(mainContent).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId("profile-dropdown-trigger").click();
  await page.getByTestId("logout-button").click();
  await expect(page.getByTestId("login-form")).toBeVisible();
}

export async function loginOrSkip(page: Page, testInfo: { skip: (condition: boolean, description: string) => void }, credentials: RoleCredentials | null, description: string) {
  testInfo.skip(!credentials, description);
  await login(page, credentials!);
}
