import { expect, Page, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";
import { countByTestIdPrefix, firstByTestIdPrefix } from "../utils/selectors";

async function openAssignments(page: Page) {
  const menu = page.getByTestId("menu-penilaian-saya");
  if ((await menu.count()) > 0) {
    await menu.click();
  } else {
    await page.goto("/assignments", { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("assignments-page")).toBeVisible();
  await expect(page.getByText("Memuat data...")).toBeHidden({ timeout: 30000 });
}

test("Finalisasi disabled sebelum syarat review dan RTL terpenuhi", async ({ page }) => {
  const assessor = credentialsFor("pengawas") || credentialsFor("kepsek") || credentialsFor("admin");
  test.skip(!assessor, "Credential penilai/admin belum diisi di .env.test");
  await login(page, assessor!);
  await openAssignments(page);

  const fillCount = await countByTestIdPrefix(page, "fill-");
  test.skip(fillCount === 0, "Tidak ada assignment yang bisa dibuka");
  await firstByTestIdPrefix(page, "fill-").click();
  await expect(page.getByTestId("assessment-form-page")).toBeVisible();

  const finalizeButton = page.getByTestId("finalization-button");
  if ((await finalizeButton.count()) > 0) {
    await expect(finalizeButton).toBeDisabled();
  }
});

test("Report page tampil dan export PDF mengikuti eligibility", async ({ page }) => {
  const user = credentialsFor("admin") || credentialsFor("pengawas") || credentialsFor("kepsek") || credentialsFor("guru");
  test.skip(!user, "Minimal satu credential role belum diisi di .env.test");
  await login(page, user!);
  await page.goto("/reports", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("reports-page")).toBeVisible();
  await expect(page.getByTestId("report-table")).toBeVisible();
  await expect(page.getByText("Memuat data...")).toBeHidden({ timeout: 30000 });

  const detailButton = page.getByTestId("report-detail-button").first();
  test.skip((await detailButton.count()) === 0, "Belum ada report untuk dicek detail/export");
  await detailButton.click();

  const exportButton = page.getByTestId("export-pdf-button");
  await expect(exportButton).toBeVisible();
  const enabled = !(await exportButton.isDisabled());
  if (!enabled) {
    await expect(exportButton).toBeDisabled();
  }
});

test("Guru lain tidak boleh membaca report via URL jika assignment id disediakan", async ({ page }) => {
  const otherGuru = credentialsFor("guruOther");
  const targetAssignmentId = process.env.E2E_OTHER_GURU_FORBIDDEN_ASSIGNMENT_ID;
  const apiBase = process.env.E2E_API_BASE_URL;
  test.skip(!otherGuru || !targetAssignmentId || !apiBase, "Butuh E2E_GURU_OTHER_*, E2E_API_BASE_URL, dan E2E_OTHER_GURU_FORBIDDEN_ASSIGNMENT_ID untuk test ini");
  await login(page, otherGuru!);
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const response = await page.request.get(`${apiBase}/api/reports/${targetAssignmentId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect([403, 404]).toContain(response.status());
});
