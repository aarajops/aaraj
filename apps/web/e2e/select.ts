import type { Page } from "@playwright/test";

export async function chooseSelectOption(
  page: Page,
  label: string,
  option: string | RegExp,
) {
  await page.getByRole("combobox", { name: label }).click();
  const optionLocator =
    typeof option === "string"
      ? page.getByRole("option", { name: option, exact: true })
      : page.getByRole("option", { name: option });
  await optionLocator.click();
}
