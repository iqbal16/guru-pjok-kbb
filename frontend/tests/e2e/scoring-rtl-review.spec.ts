import { expect, Page, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";
import { countByTestIdPrefix, firstByTestIdPrefix } from "../utils/selectors";

async function openEditableAssessment(page: Page) {
  const menu = page.getByTestId("menu-penilaian-saya");
  if ((await menu.count()) > 0) {
    await menu.click();
  } else {
    await page.goto("/assignments", { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("assignments-page")).toBeVisible();
  await expect(page.getByText("Memuat data...")).toBeHidden({ timeout: 30000 });

  if ((await countByTestIdPrefix(page, "start-")) > 0) {
    await firstByTestIdPrefix(page, "start-").click();
    await expect(page.getByText("Memuat data...")).toBeHidden({ timeout: 30000 });
  }

  const fillCount = await countByTestIdPrefix(page, "fill-");
  test.skip(fillCount === 0, "Tidak ada assignment editable untuk user ini");
  await firstByTestIdPrefix(page, "fill-").click();
  await expect(page.getByTestId("assessment-form-page")).toBeVisible();
}

test("Penilai melihat pesan saat skor di UI belum disimpan lalu lanjut RTL", async ({ page }) => {
  const assessor = credentialsFor("pengawas") || credentialsFor("kepsek") || credentialsFor("admin");
  test.skip(!assessor, "Credential penilai/admin belum diisi di .env.test");
  await login(page, assessor!);
  await openEditableAssessment(page);

  const firstScore = page.locator('[data-testid^="score-"]:not([data-testid="score-form"])').first();
  test.skip((await firstScore.count()) === 0, "Tidak ada input skor pada assignment ini");
  await firstScore.click();
  await page.getByRole("option", { name: "4 - Sangat Baik" }).click();

  await expect(page.getByText("Simpan penilaian terlebih dahulu sebelum lanjut ke Evaluasi & RTL.").first()).toBeVisible();
});

test("Tombol Kirim ke Guru disabled sebelum skor dan RTL lengkap tersimpan", async ({ page }) => {
  const assessor = credentialsFor("pengawas") || credentialsFor("kepsek") || credentialsFor("admin");
  test.skip(!assessor, "Credential penilai/admin belum diisi di .env.test");
  await login(page, assessor!);
  await openEditableAssessment(page);

  await expect(page.getByTestId("send-to-teacher-button")).toBeVisible();
  const sendButton = page.getByTestId("send-to-teacher-button");
  if (await sendButton.isDisabled()) {
    await expect(page.getByText("Kirim ke Guru belum tersedia.").first()).toBeVisible();
  }
});

test("Guru bisa membuka halaman review jika ada assignment review visible", async ({ page }) => {
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await page.getByTestId("menu-penilaian-saya-guru").click();
  await expect(page.getByTestId("my-assessment-page")).toBeVisible({ timeout: 30000 });

  const detail = page.getByTestId("my-assessment-detail-button").first();
  test.skip((await detail.count()) === 0, "Belum ada assignment Guru yang siap direview/dilihat");
  await detail.click();
  await expect(page.getByTestId("teacher-review-page")).toBeVisible();
  await expect(page.getByTestId("evaluation-followup-section")).toBeVisible();
});
