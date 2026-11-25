import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  BANGLADESH_GEOGRAPHY_SCHEMA_VERSION,
  DEFAULT_LIST_PAGE_SIZE,
} from "@aaraj/contracts";

const testDivisionId = "00000000-0000-4000-8000-000000000101";
const testDistrictId = "00000000-0000-4000-8000-000000000102";

async function mockManualOrderGeography(page: Page) {
  await page.route("**/api/v1/geography", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: BANGLADESH_GEOGRAPHY_SCHEMA_VERSION,
        datasetVersion: "E2E_GEOGRAPHY_V1",
        authority: "Bangladesh National Portal",
        snapshotDate: "2026-10-08",
        locations: [
          {
            id: testDivisionId,
            level: "division",
            parentId: null,
            name: "Dhaka",
          },
          {
            id: testDistrictId,
            level: "district",
            parentId: testDivisionId,
            name: "Dhaka District",
          },
        ],
      }),
    });
  });
}

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

test("Orders uses shared pagination, order previews, and stable URL history", async ({
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
  await expect(table.locator("tbody tr")).toHaveCount(DEFAULT_LIST_PAGE_SIZE);
  await expect(table.getByText("Uncollected", { exact: true })).toHaveCount(0);
  await expect(table.getByText("Not payable", { exact: true })).toHaveCount(0);
  await expect(table.getByText("ORD-026-00001", { exact: true })).toBeVisible();
  await expect(
    table.getByRole("button", { name: "ORD-026-00001", exact: true }),
  ).toHaveAttribute("aria-haspopup", "dialog");
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/admin/orders\\?limit=${DEFAULT_LIST_PAGE_SIZE}&offset=${DEFAULT_LIST_PAGE_SIZE}$`,
    ),
  );
  await expect(table.locator("tbody tr")).toHaveCount(DEFAULT_LIST_PAGE_SIZE);
  await expect(table.getByText("ORD-026-00021", { exact: true })).toBeVisible();
  await expect(
    table.getByRole("button", { name: "ORD-026-00021", exact: true }),
  ).toHaveAttribute("aria-haspopup", "dialog");

  await page.getByRole("link", { name: "Go to previous page" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/orders\\?limit=${DEFAULT_LIST_PAGE_SIZE}$`),
  );
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(
      `/admin/orders\\?limit=${DEFAULT_LIST_PAGE_SIZE}&offset=${DEFAULT_LIST_PAGE_SIZE}$`,
    ),
  );
  await page.goForward();
  await expect(page).toHaveURL(
    new RegExp(`/admin/orders\\?limit=${DEFAULT_LIST_PAGE_SIZE}$`),
  );
});

test("Orders displays the latest Pathao shipment progress", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsStaff(context, baseURL);
  await page.goto("/admin/orders");

  const row = page
    .getByRole("table", { name: "Orders" })
    .getByRole("row", { name: /ORD-026-00003/ });
  await expect(row.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(row.getByText("Needs review", { exact: true })).toHaveCount(0);
  await expect(
    row.getByText("E2E-PATHAO-DELIVERED", { exact: true }),
  ).toHaveCount(0);
});

test("staff can open manual order creation and select an existing customer", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsStaff(context, baseURL);
  await mockManualOrderGeography(page);

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/create$/);
  await expect(
    page.getByRole("heading", { name: "Create Order", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Delivery details" }),
  ).toBeVisible();
  const customerSearch = page.getByRole("searchbox", {
    name: "Search existing customer accounts (optional)",
  });
  await customerSearch.fill("E2E Returning Customer");
  await page.getByRole("button", { name: /E2E Returning Customer/ }).click();
  await expect(page.getByLabel("Recipient name")).toHaveValue(
    "E2E Returning Customer",
  );
  await page.getByLabel("Division").selectOption(testDivisionId);
  await page.getByLabel("District").selectOption(testDistrictId);
  await page
    .getByLabel("Street address and delivery instructions")
    .fill("House 12, Road 5");
  await expect(
    page.getByRole("button", { name: "Preview current total" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Create confirmed COD Order" }),
  ).toHaveCount(0);
});

test("manual order confirms the server total before creating a COD order", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsStaff(context, baseURL);
  await mockManualOrderGeography(page);

  const productId = "00000000-0000-4000-8000-000000000201";
  const variantId = "00000000-0000-4000-8000-000000000202";
  const replacementVariantId = "00000000-0000-4000-8000-000000000204";
  const createdOrderId = "00000000-0000-4000-8000-000000000203";
  const timestamp = "2026-10-08T12:00:00.000Z";
  const product = {
    id: productId,
    productType: "single",
    slug: "manual-e2e-jacket",
    name: "Manual E2E Jacket",
    description: null,
    audience: "unisex",
    category: null,
    fit: null,
    fabricComposition: null,
    careInstructions: null,
    sizeGuideId: null,
    price: { amountBdt: 3000 },
    compareAtPrice: { amountBdt: 4000 },
    isPublished: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let previewRequest: Record<string, unknown> | null = null;
  let createRequest: Record<string, unknown> | null = null;
  let createIdempotencyKey: string | undefined;

  await page.route("**/api/v1/catalog/products/manage**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/catalog/products/manage") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          products: [{ ...product, thumbnail: null }],
          limit: 10,
          offset: 0,
          hasMore: false,
          nextOffset: null,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...product,
        editRevision: 1,
        variants: [
          {
            id: variantId,
            color: "Black",
            sizeLabel: "M",
            price: { amountBdt: 3000 },
            compareAtPrice: { amountBdt: 4000 },
            sku: "MANUAL-E2E-01",
            isActive: true,
          },
          {
            id: replacementVariantId,
            color: "Black",
            sizeLabel: "L",
            price: { amountBdt: 3000 },
            compareAtPrice: { amountBdt: 4000 },
            sku: "MANUAL-E2E-02",
            isActive: true,
          },
        ],
        sizeGuide: null,
        combo: null,
      }),
    });
  });
  await page.route("**/api/v1/orders/manage/manual/preview", async (route) => {
    previewRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lines: [
          {
            variantId: replacementVariantId,
            comboGroupId: null,
            productName: "Manual E2E Jacket",
            color: "Black",
            sizeLabel: "L",
            quantity: 1,
            unitPriceBdt: 3000,
            compareAtPriceBdt: 4000,
            grossAmountBdt: 3000,
          },
        ],
        comboGroups: [],
        merchandiseGrossBdt: 3000,
        deliveryAmountBdt: 120,
        totalBdt: 3120,
        fingerprint: "a".repeat(64),
      }),
    });
  });
  await page.route("**/api/v1/orders/manage/manual", async (route) => {
    createRequest = route.request().postDataJSON() as Record<string, unknown>;
    createIdempotencyKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: createdOrderId,
        reference: "ORD-026-00009",
        totalBdt: 3120,
        codAmountDueBdt: 3120,
        status: "confirmed",
        paymentMethod: "cod",
        collectionStatus: "uncollected",
        fulfillmentStatus: "awaiting_dispatch",
        createdAt: timestamp,
        guestAccessExpiresAt: null,
        replayed: false,
      }),
    });
  });

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "Create order" }).click();
  await page.getByLabel("Recipient name").fill("Manual Guest Recipient");
  await page.getByLabel("Bangladesh mobile number").fill("01712345678");
  await page.getByLabel("Division").selectOption(testDivisionId);
  await page.getByLabel("District").selectOption(testDistrictId);
  await page
    .getByLabel("Street address and delivery instructions")
    .fill("House 12, Road 5");
  await page
    .getByRole("searchbox", { name: "Search published products" })
    .fill("Manual E2E");
  await page.getByRole("button", { name: "Manual E2E Jacket" }).click();
  await page.getByLabel("Color and size").selectOption(variantId);
  await page.getByRole("button", { name: "Add item" }).click();
  await page
    .getByRole("button", { name: "Edit Manual E2E Jacket Black M" })
    .click();
  await page.getByLabel("Color and size").selectOption(replacementVariantId);
  await page.getByRole("button", { name: "Update item" }).click();
  await expect(page.getByText("Black · L · Qty 1")).toBeVisible();
  await page.getByRole("button", { name: "Preview current total" }).click();
  await expect(
    page.getByRole("heading", { name: "Current COD total" }),
  ).toBeVisible();
  await expect(page.getByText("৳3,120", { exact: true })).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "The customer agreed to pay ৳3,120 by cash on delivery.",
    })
    .check();
  await page
    .getByRole("button", { name: "Create confirmed COD Order" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/admin/orders/${createdOrderId}$`));
  expect(previewRequest).toMatchObject({
    customerId: null,
    lines: [{ variantId: replacementVariantId, quantity: 1 }],
  });
  expect(createRequest).toMatchObject({
    acceptedTotalBdt: 3120,
    customerAgreed: true,
    previewFingerprint: "a".repeat(64),
  });
  expect(createIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
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
  await expect(table.getByText("ORD-026-00026", { exact: true })).toBeVisible();
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
  await search.fill("ORD-026-00033");
  await page.getByRole("button", { name: "Apply orders search" }).click();
  await expect(page).toHaveURL(
    /\/admin\/orders\?limit=25&search=ORD-026-00033$/,
  );
  await expect(search).toHaveValue("ORD-026-00033");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByText("ORD-026-00033", { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/orders\?limit=25&offset=25$/);
  await page.goForward();
  await expect(page).toHaveURL(
    /\/admin\/orders\?limit=25&search=ORD-026-00033$/,
  );
  await page.reload();
  await expect(search).toHaveValue("ORD-026-00033");
  await expect(table.locator("tbody tr")).toHaveCount(1);

  await search.fill("ORD-026-99998");
  await page.getByRole("button", { name: "Apply orders search" }).click();
  await expect(table.getByText("No matching orders.")).toBeVisible();

  await page.goto("/admin/orders?search=ORD-026-99999");
  await expect(
    page.getByRole("heading", { name: "Orders unavailable" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Order management could not be loaded." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    "/admin/orders?search=ORD-026-99999",
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
  const table = page.getByRole("table", { name: "Webhook exceptions" });
  await expect(
    table.getByRole("row", { name: /Shipment Created/ }),
  ).toBeVisible();
  await expect(
    table.getByRole("button", {
      name: "Actions for webhook exceptions row 1",
    }),
  ).toHaveCount(0);
  await expect(page.getByText("Loading Pathao issues…")).toHaveCount(0);
});
