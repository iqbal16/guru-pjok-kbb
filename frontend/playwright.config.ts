import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValue] = trimmed.split("=");
    const key = rawKey.trim();
    const value = rawValue.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const frontendDir = __dirname;
const rootDir = path.resolve(frontendDir, "..");

loadEnvFile(path.join(rootDir, ".env.test"));
loadEnvFile(path.join(frontendDir, ".env.test"));

const localChromium = "D:\\PlaywrightBrowsers\\chromium_headless_shell-1217\\chrome-headless-shell-win64\\chrome-headless-shell.exe";
const chromiumExecutablePath = process.env.E2E_CHROMIUM_EXECUTABLE_PATH
  || (fs.existsSync(localChromium) ? localChromium : undefined);

export default defineConfig({
  testDir: path.join(frontendDir, "tests", "e2e"),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(rootDir, "playwright-report"), open: "never" }],
  ],
  outputDir: path.join(rootDir, "test-results"),
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: chromiumExecutablePath } } },
    { name: "mobile-chrome", testMatch: /mobile-responsive\.spec\.ts/, use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, launchOptions: { executablePath: chromiumExecutablePath } } },
  ],
});
