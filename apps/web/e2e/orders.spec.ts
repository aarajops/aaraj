import { expect, test, type BrowserContext } from "@playwright/test";

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

test("Orders uses shared pagination with stable URL history and order links", async ({
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
    table.getByRole("link", { name: "AA-000000000001" }),
  ).toHaveAttribute(
    "href",
    "/admin/orders/00000000-0000-4000-8000-000000000001",
  );
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50&offset=50$/);
  await expect(table.locator("tbody tr")).toHaveCount(23);
  await expect(
    table.getByText("AA-000000000033", { exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("link", { name: "AA-000000000033" }),
  ).toHaveAttribute(
    "href",
    "/admin/orders/00000000-0000-4000-8000-000000000033",
  );

  await page.getByRole("link", { name: "Go to previous page" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50&offset=50$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=50$/);
});

test("Orders follows API pagination, search, empty, and error states", async ({
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
    page.getByText("Showing 26–50 orders", { exact: true }),
  ).toBeVisible();

  await expect(
    page.getByRole("combobox", { name: "Rows per page" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=25&offset=50$/);
  await expect(table.locator("tbody tr")).toHaveCount(23);
  await page.getByRole("link", { name: "Go to previous page" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=25&offset=25$/);

  const search = page.getByRole("searchbox", { name: "Search orders" });
  await search.fill("AA-000000000033");
  await page.getByRole("button", { name: "Apply orders search" }).click();
  await expect(page).toHaveURL(
    /\/admin\/orders\?limit=25&search=AA-000000000033$/,
  );
  await expect(search).toHaveValue("AA-000000000033");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(
    table.getByText("AA-000000000033", { exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=25&offset=25$/);
  await page.goForward();
  await expect(page).toHaveURL(
    /\/admin\/orders\?limit=25&search=AA-000000000033$/,
  );
  await page.reload();
  await expect(search).toHaveValue("AA-000000000033");
  await expect(table.locator("tbody tr")).toHaveCount(1);

  await search.fill("AA-FFFFFFFFFFFE");
  await page.getByRole("button", { name: "Apply orders search" }).click();
  await expect(table.getByText("No matching orders.")).toBeVisible();

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

test("Delivery issues renders its server-loaded exception page", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsStaff(context, baseURL);
  await page.goto("/admin/orders/reconciliation");

  await expect(
    page.getByRole("heading", { name: "Delivery issues", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Webhook exceptions" }),
  ).toBeVisible();
  await expect(
    page.getByText("No webhook exceptions need attention."),
  ).toBeVisible();
  await expect(page.getByText("Loading Pathao issues…")).toHaveCount(0);
});
