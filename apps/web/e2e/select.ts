import type { Page } from "@playwright/test";

export async function chooseSelectOption(
  page: Page,
  label: string,
  option: string | RegExp,
) {
  await page.getByRole("combobox", { name: label }).click();
  const optionLocator = page.getByRole("listbox").getByRole("option", {
    name: option,
    ...(typeof option === "string" ? { exact: true } : {}),
  });
  await optionLocator.click();
}
