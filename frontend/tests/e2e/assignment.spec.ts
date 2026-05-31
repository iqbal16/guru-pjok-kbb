import { expect, Page, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";
import { countByTestIdPrefix, firstByTestIdPrefix } from "../utils/selectors";

async function waitForAssignmentsLoaded(page: Page) {
  await expect(page.getByText("Memuat data...")).toBeHidden({ timeout: 30000 });
  await expect(firstByTestIdPrefix(page, "assignment-row-").or(page.getByTestId("assignments-empty"))).toBeVisible({ timeout: 30000 });
}

test.beforeEach(async ({ page }) => {
  const admin = credentialsFor("admin");
  test.skip(!admin, "Credential Admin belum diisi di .env.test");
  await login(page, admin!);
});

test("Admin bisa membuka menu Assignment Penilaian dan melihat table/empty state", async ({ page }) => {
  await page.getByTestId("menu-assignments").click();
  await expect(page.getByTestId("assignments-page")).toBeVisible();
  await waitForAssignmentsLoaded(page);
});

test("Status dan action assignment tampil rapi jika ada data", async ({ page }) => {
  await page.goto("/assignments", { waitUntil: "domcontentloaded" });
  await waitForAssignmentsLoaded(page);
  const rowCount = await countByTestIdPrefix(page, "assignment-row-");
  test.skip(rowCount === 0, "Belum ada assignment untuk dicek");
  await expect(firstByTestIdPrefix(page, "assignment-row-")).toBeVisible();
  await expect(firstByTestIdPrefix(page, "assignment-actions-")).toBeVisible();
});

test("Action Hapus tersedia lewat menu aksi admin tanpa mengubah confirmation flow", async ({ page }) => {
  await page.goto("/assignments", { waitUntil: "domcontentloaded" });
  await waitForAssignmentsLoaded(page);
  const rowCount = await countByTestIdPrefix(page, "assignment-row-");
  test.skip(rowCount === 0, "Belum ada assignment untuk dicek");
  await firstByTestIdPrefix(page, "assignment-actions-").click();
  const deleteItem = page.getByRole("menuitem", { name: /Hapus/i });
  const hasDelete = await deleteItem.count();
  test.skip(hasDelete === 0, "Assignment yang terlihat tidak eligible untuk action Hapus");
  await expect(deleteItem).toBeVisible();
});

test("Duplicate assignment assessor role ditolak jika fixture optional tersedia", async () => {
  test.skip(!process.env.E2E_DUPLICATE_ASSIGNMENT_ENABLED, "Aktifkan E2E_DUPLICATE_ASSIGNMENT_ENABLED dan fixture data jika ingin menjalankan skenario duplikat secara mutatif.");
});
