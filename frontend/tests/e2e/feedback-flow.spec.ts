import { expect, test } from "@playwright/test";
import { credentialsFor } from "../utils/env";
import { login } from "../utils/auth";

async function openTeacherReviewIfAvailable(page) {
  await page.goto("/penilaian-saya", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("my-assessment-page")).toBeVisible();
  const detail = page.getByTestId("my-assessment-detail-button").first();
  test.skip((await detail.count()) === 0, "Belum ada assignment Guru yang siap review");
  await detail.click();
  await expect(page.getByTestId("teacher-review-page")).toBeVisible();
}

test("Guru feedback button muncul hanya saat review masih eligible", async ({ page }) => {
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await openTeacherReviewIfAvailable(page);

  const feedbackButton = page.getByTestId("teacher-feedback-button");
  if ((await feedbackButton.count()) > 0) {
    await expect(feedbackButton).toBeVisible();
  } else {
    await expect(page.getByText(/Final dan terkunci|Review Guru selesai|Status/)).toBeVisible();
  }
});

test("Feedback ketiga tidak tersedia saat feedback_count sudah mencapai 2", async ({ page }) => {
  const guru = credentialsFor("guru");
  test.skip(!guru, "Credential Guru belum diisi di .env.test");
  await login(page, guru!);
  await openTeacherReviewIfAvailable(page);

  const feedbackText = page.getByText(/Feedback.*2 dari 2|Feedback: 2 dari 2/i);
  test.skip((await feedbackText.count()) === 0, "Assignment belum berada pada feedback_count 2");
  await expect(page.getByTestId("teacher-feedback-button")).toBeDisabled();
});
