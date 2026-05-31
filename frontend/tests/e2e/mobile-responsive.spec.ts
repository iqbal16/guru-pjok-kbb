import { expect, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";

test("Login page mobile tidak tumpang tindih", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("login-email-input")).toBeVisible();
  await expect(page.getByTestId("login-password-input")).toBeVisible();
});

test("Dashboard dan Assignment mobile bisa dibuka", async ({ page }) => {
  const user = credentialsFor("admin") || credentialsFor("pengawas") || credentialsFor("kepsek") || credentialsFor("guru");
  test.skip(!user, "Minimal satu credential role belum diisi di .env.test");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, user!);
  await expect(page.getByTestId("main-content")).toBeVisible();

  if (user!.role === "guru") {
    await page.goto("/penilaian-saya", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("my-assessment-page")).toBeVisible();
  } else {
    await page.goto("/assignments", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("assignments-page")).toBeVisible();
  }
});

test("Mobile validation error tetap terlihat pada login invalid", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email-input").fill("bad@example.test");
  await page.getByTestId("login-password-input").fill("bad");
  await page.getByTestId("login-submit-button").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
});
