import { Locator, Page } from "@playwright/test";

export function firstByTestIdPrefix(page: Page, prefix: string): Locator {
  return page.locator(`[data-testid^="${prefix}"]`).first();
}

export async function countByTestIdPrefix(page: Page, prefix: string): Promise<number> {
  return page.locator(`[data-testid^="${prefix}"]`).count();
}

export async function hasAny(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0;
}
