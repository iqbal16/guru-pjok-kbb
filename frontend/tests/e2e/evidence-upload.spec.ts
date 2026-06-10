import { expect, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";

test("Guru melihat menu Bukti Pendukung Penilaian dan status kelengkapan", async ({ page }) => {
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await page.getByTestId("menu-evidence").click();
  await expect(page.getByTestId("evidence-page")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Bukti Pendukung Penilaian")).toBeVisible();
  await expect(page.getByText(/Status:/)).toBeVisible();
  await expect(page.getByText(/Dokumen:/)).toBeVisible();
  await expect(page.getByText(/Video:/)).toBeVisible();
});

test("Guru mendapat validasi frontend saat format dokumen tidak didukung", async ({ page }) => {
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await page.goto("/bukti-pendukung", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("evidence-page")).toBeVisible({ timeout: 30000 });

  const inputs = page.locator('input[type="file"]');
  test.skip((await inputs.count()) === 0, "Upload tidak tersedia pada data/semester saat ini");
  await inputs.first().setInputFiles({
    name: "script.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("not allowed"),
  });
  await expect(page.getByTestId("evidence-error")).toContainText("Format dokumen tidak didukung");
});

test("Guru bisa upload dokumen dan video valid jika storage test diaktifkan", async ({ page }) => {
  test.skip(process.env.E2E_EVIDENCE_UPLOAD_ENABLED !== "1", "Aktifkan E2E_EVIDENCE_UPLOAD_ENABLED=1 hanya jika storage DEV sudah dikonfigurasi");
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await page.goto("/bukti-pendukung", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("evidence-page")).toBeVisible({ timeout: 30000 });

  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles({
    name: "bukti-test.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% E2E small fixture\n"),
  });
  await expect(page.getByText("Dokumen berhasil diunggah")).toBeVisible({ timeout: 30000 });

  await inputs.nth(1).setInputFiles({
    name: "video-test.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("small-webm-fixture"),
  });
  await expect(page.getByText("Video berhasil diunggah")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Siap Dinilai|Terkunci/)).toBeVisible();
});
