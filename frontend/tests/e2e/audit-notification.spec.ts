import { expect, Page, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";

async function openAuditLog(page: Page) {
  const menu = page.getByTestId("menu-audit-log");
  if ((await menu.count()) > 0) {
    await menu.click();
  } else {
    await page.goto("/audit-log", { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("audit-log-page")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("audit-log-table")).toBeVisible({ timeout: 30000 });
}

test("Admin bisa membuka Audit Log tanpa error 500 UI", async ({ page }) => {
  const admin = credentialsFor("admin");
  test.skip(!admin, "Credential Admin belum diisi di .env.test");
  await login(page, admin!);
  await openAuditLog(page);
  await expect(page.getByText("Terjadi kesalahan. Silakan coba lagi.")).toHaveCount(0);
});

test("Audit Log menampilkan table atau empty state", async ({ page }) => {
  const admin = credentialsFor("admin");
  test.skip(!admin, "Credential Admin belum diisi di .env.test");
  await login(page, admin!);
  await openAuditLog(page);
});

test("Non-admin tidak bisa membuka Audit Log", async ({ page }) => {
  const user = credentialsFor("guru") || credentialsFor("pengawas") || credentialsFor("kepsek");
  test.skip(!user, "Minimal satu credential non-admin belum diisi di .env.test");
  await login(page, user!);
  await page.goto("/audit-log", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("audit-log-page")).toHaveCount(0);
});

test("Notifikasi bisa dibuka dan mark as read berjalan jika ada unread", async ({ page }) => {
  const user = credentialsFor("admin") || credentialsFor("guru") || credentialsFor("pengawas") || credentialsFor("kepsek");
  test.skip(!user, "Minimal satu credential role belum diisi di .env.test");
  await login(page, user!);
  await page.getByTestId("notification-button").click();
  await expect(page.getByTestId("notifications-page")).toBeVisible();
  await expect(page.getByTestId("notification-list")).toBeVisible();

  const markRead = page.getByTestId("notification-mark-read").first();
  if ((await markRead.count()) > 0) {
    await markRead.click();
    await expect(markRead).toHaveCount(0);
  }
});
