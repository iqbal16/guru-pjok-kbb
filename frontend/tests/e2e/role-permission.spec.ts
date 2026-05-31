import { expect, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";
import { firstByTestIdPrefix } from "../utils/selectors";

test("Guru tidak melihat menu admin dan audit log", async ({ page }) => {
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await expect(page.getByTestId("menu-users")).toHaveCount(0);
  await expect(page.getByTestId("menu-audit-log")).toHaveCount(0);
});

test("Non-admin akses URL Audit Log ditolak dari UI", async ({ page }) => {
  const guru = credentialsFor("guru") || credentialsFor("pengawas") || credentialsFor("kepsek");
  test.skip(!guru, "Minimal satu credential non-admin harus diisi di .env.test");
  await login(page, guru!);
  await page.goto("/audit-log", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("audit-log-page")).toHaveCount(0);
});

test("Admin dapat melihat menu Audit Log", async ({ page }) => {
  const admin = credentialsFor("admin");
  test.skip(!admin, "Credential Admin belum diisi di .env.test");
  await login(page, admin!);
  await expect(page.getByTestId("menu-audit-log")).toBeVisible();
});

test("Kepsek/Pengawas hanya mendapat aksi penilaian sesuai assignment yang terlihat", async ({ page }) => {
  const assessor = credentialsFor("kepsek") || credentialsFor("pengawas");
  test.skip(!assessor, "Credential Kepsek atau Pengawas belum diisi di .env.test");
  await login(page, assessor!);
  await page.getByTestId("menu-penilaian-saya").click();
  await expect(page.getByTestId("assignments-page")).toBeVisible();
  await expect(page.getByText("Memuat data...")).toBeHidden({ timeout: 30000 });
  await expect(firstByTestIdPrefix(page, "assignment-row-").or(page.getByTestId("assignments-empty"))).toBeVisible({ timeout: 30000 });
});
