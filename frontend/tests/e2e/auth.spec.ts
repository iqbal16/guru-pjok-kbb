import { expect, test } from "@playwright/test";
import { configuredRoles, credentialsFor } from "../utils/env";
import { login, logout } from "../utils/auth";

for (const role of ["admin", "pengawas", "kepsek", "guru"] as const) {
  test(`${role} login success`, async ({ page }) => {
    const credentials = credentialsFor(role);
    test.skip(!credentials, `Credential ${role} belum diisi di .env.test`);
    await login(page, credentials!);
    await expect(page.getByTestId("sidebar")).toBeVisible();
  });
}

test("invalid login rejected", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email-input").fill("invalid@example.test");
  await page.getByTestId("login-password-input").fill("wrong-password");
  await page.getByTestId("login-submit-button").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
});

test("logout success", async ({ page }) => {
  const credentials = configuredRoles()[0];
  test.skip(!credentials, "Minimal satu credential role harus diisi di .env.test");
  await login(page, credentials!);
  await logout(page);
});
