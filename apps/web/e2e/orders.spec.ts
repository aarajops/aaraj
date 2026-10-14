import { expect, test, type BrowserContext } from "@playwright/test";
import { chooseSelectOption } from "./select";

async function signInAsStaff(
  context: BrowserContext,
  baseURL: string | undefined,
) {
  await context.addCookies([
    {
      name: "aaraj-e2e-role",
      value: "staff",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("Orders uses shared pagination with stable URL history and Review links", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsStaff(context, baseURL);
  await page.goto("/admin/orders");

  await expect(
    page.getByRole("heading", { name: "Orders", level: 1 }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Orders" });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(
    table.getByText("AA-000000000001", { exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("link", { name: "Review" }).first(),
  ).toHaveAttribute(
    "href",
    "/admin/orders/00000000-0000-4000-8000-000000000001",
  );

  await page.getByRole("link", { name: "Next orders page" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50&offset=50$/);
  await expect(table.locator("tbody tr")).toHaveCount(23);
  await expect(
    table.getByText("AA-000000000033", { exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("link", { name: "Review" }).first(),
  ).toHaveAttribute(
    "href",
    "/admin/orders/00000000-0000-4000-8000-000000000033",
  );

  await page.getByRole("link", { name: "Previous orders page" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50&offset=50$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50$/);
});

test("Orders preserves direct query state, page size, search, empty, and error states", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsStaff(context, baseURL);
  await page.goto("/admin/orders?limit=25&offset=25");

  const table = page.getByRole("table", { name: "Orders" });
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(
    table.getByText("AA-00000000001A", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Orders pagination" }),
  ).toContainText("Page 2");

  await chooseSelectOption(page, "Rows per page", "100");
  await expect(page).toHaveURL(/\/admin\/orders\?limit=100$/);
  await expect(table.locator("tbody tr")).toHaveCount(73);

  const search = page.getByRole("searchbox", { name: "Search orders" });
  await search.fill("AA-000000000033");
  await page.getByRole("button", { name: "Apply orders search" }).click();
  await expect(page).toHaveURL(
    /\/admin\/orders\?limit=100&search=AA-000000000033$/,
  );
  await expect(search).toHaveValue("AA-000000000033");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(
    table.getByText("AA-000000000033", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(search).toHaveValue("AA-000000000033");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=100$/);
  await page.goForward();
  await expect(page).toHaveURL(
    /\/admin\/orders\?limit=100&search=AA-000000000033$/,
  );

  await search.fill("AA-FFFFFFFFFFFE");
  await page.getByRole("button", { name: "Apply orders search" }).click();
  await expect(
    table.getByText("No orders match this reference search."),
  ).toBeVisible();

  await page.goto("/admin/orders?search=AA-FFFFFFFFFFFF");
  await expect(
    page.getByRole("heading", { name: "Orders unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Order management could not be loaded.",
  );
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/admin/orders?search=AA-FFFFFFFFFFFF",
  );
});
