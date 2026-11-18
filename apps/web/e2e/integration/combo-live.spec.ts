import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { chooseSelectOption } from "../select";

const origin = "http://127.0.0.1:3180";
const catalogEmail = "catalog-e2e@example.test";
const catalogPassword = "CatalogE2E-Only-Password-2026!";
const brandPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWO4I+d2R86NAYUCAFJZB4Fg78ImAAAAAElFTkSuQmCC",
  "base64",
);

type SourceProduct = {
  id: string;
  name: string;
  variants: Map<string, { id: string; priceBdt: number }>;
};

async function createPublishedSourceProduct(
  page: import("@playwright/test").Page,
  input: {
    suffix: string;
    name: string;
    categoryId: string;
    sizeGuideId: string;
    colors: string[];
    priceBdt: number;
  },
): Promise<SourceProduct> {
  const sizes = ["S", "M", "L"];
  const variants = input.colors.flatMap((color) =>
    sizes.map((sizeLabel) => ({
      sku: `E2E-${input.suffix}-${color.toUpperCase()}-${sizeLabel}`,
      color,
      sizeLabel,
      price: { amountBdt: input.priceBdt },
      compareAtPrice: { amountBdt: input.priceBdt + 500 },
    })),
  );
  const createdResponse = await page.request.post("/api/v1/catalog/products", {
    headers: { Origin: origin },
    data: {
      productType: "single",
      slug: `${input.suffix}-source`,
      name: input.name,
      description: `${input.name} source product for the live Combo integration journey.`,
      audience: "unisex",
      categoryId: input.categoryId,
      fit: "Regular",
      sizeGuideId: input.sizeGuideId,
      variants,
      isPublished: false,
    },
  });
  expect(createdResponse.status()).toBe(201);
  const createdProduct = await createdResponse.json();
  const manageResponse = await page.request.get(
    `/api/v1/catalog/products/manage/${createdProduct.id}`,
  );
  expect(manageResponse.status()).toBe(200);
  const etag = manageResponse.headers().etag;
  expect(etag).toBeTruthy();

  const mediaResponse = await page.request.post(
    `/api/v1/catalog/products/manage/${createdProduct.id}/media`,
    {
      headers: { Origin: origin },
      multipart: {
        commandId: randomUUID(),
        altText: `${input.name} product image`,
        file: {
          name: `${input.suffix}.png`,
          mimeType: "image/png",
          buffer: brandPng,
        },
      },
    },
  );
  expect(mediaResponse.status()).toBe(201);
  expect((await mediaResponse.json()).status).toBe("ready");

  const publishResponse = await page.request.patch(
    `/api/v1/catalog/products/${createdProduct.id}`,
    {
      headers: { Origin: origin, "If-Match": etag! },
      data: { isPublished: true },
    },
  );
  expect(publishResponse.status()).toBe(200);

  const publishedManageResponse = await page.request.get(
    `/api/v1/catalog/products/manage/${createdProduct.id}`,
  );
  expect(publishedManageResponse.status()).toBe(200);
  const product = await publishedManageResponse.json();
  const variantByOption = new Map<string, { id: string; priceBdt: number }>();
  for (const variant of product.variants as Array<{
    id: string;
    color: string;
    sizeLabel: string;
    price: { amountBdt: number } | null;
  }>) {
    expect(variant.price).not.toBeNull();
    variantByOption.set(`${variant.color}/${variant.sizeLabel}`, {
      id: variant.id,
      priceBdt: variant.price!.amountBdt,
    });
    const stockResponse = await page.request.post(
      `/api/v1/inventory/manage/${variant.id}/adjustments`,
      {
        headers: { Origin: origin },
        data: {
          commandId: randomUUID(),
          delta: 5,
          reason: "Seed real source inventory for Combo browser E2E",
        },
      },
    );
    expect(stockResponse.status()).toBe(201);
  }
  return { id: product.id, name: product.name, variants: variantByOption };
}

test("Combo management to partial COD fulfillment works through the real browser and database", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);

  await page.goto("/account");
  await page.getByLabel("Email", { exact: true }).fill(catalogEmail);
  await page.getByLabel("Password", { exact: true }).fill(catalogPassword);
  await page
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin$/);

  const suffix = randomUUID().slice(0, 8);
  const categoryResponse = await page.request.post(
    "/api/v1/catalog/categories",
    {
      headers: { Origin: origin },
      data: {
        name: `E2E Combo ${suffix}`,
        slug: `e2e-combo-${suffix}`,
      },
    },
  );
  expect(categoryResponse.status()).toBe(201);
  const category = await categoryResponse.json();
  const guideResponse = await page.request.post("/api/v1/catalog/size-guides", {
    headers: { Origin: origin },
    data: {
      name: `E2E Combo sizes ${suffix}`,
      categoryId: category.id,
      fit: "Regular",
      measurementBasis: "garment",
      rows: [
        {
          sizeLabel: "S",
          measurements: [{ key: "chest_width", value: "18.0" }],
        },
        {
          sizeLabel: "M",
          measurements: [{ key: "chest_width", value: "20.0" }],
        },
        {
          sizeLabel: "L",
          measurements: [{ key: "chest_width", value: "22.0" }],
        },
      ],
    },
  });
  expect(guideResponse.status()).toBe(201);
  const guide = await guideResponse.json();

  const fullZip = await createPublishedSourceProduct(page, {
    suffix: `${suffix}-full`,
    name: `E2E Full Zip ${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    colors: ["Navy", "Black"],
    priceBdt: 2200,
  });
  const halfZip = await createPublishedSourceProduct(page, {
    suffix: `${suffix}-half`,
    name: `E2E Half Zip ${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    colors: ["White", "Red"],
    priceBdt: 1800,
  });

  const comboName = `E2E Two Piece Combo ${suffix}`;
  const comboSlug = `e2e-two-piece-combo-${suffix}`;
  let productCreateRequests = 0;
  let comboConfigurationRequests = 0;
  await page.route("**/api/v1/catalog/products", async (route) => {
    if (route.request().method() === "POST") productCreateRequests += 1;
    await route.continue();
  });
  await page.route("**/api/v1/catalog/combos/manage/*", async (route) => {
    if (route.request().method() === "PUT") {
      comboConfigurationRequests += 1;
      if (comboConfigurationRequests === 1) {
        await route.fulfill({
          status: 503,
          json: {
            statusCode: 503,
            message:
              "Temporary Combo configuration failure for retry coverage.",
          },
        });
        return;
      }
    }
    await route.continue();
  });
  await page.goto("/admin/catalog/create");
  await chooseSelectOption(page, "Product type", "Combo");
  await page.getByLabel("Name", { exact: true }).fill(comboName);
  await page.locator("#product-slug").fill(comboSlug);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A two piece Combo created in a real admin and customer journey.");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Product category", category.name);
  await chooseSelectOption(page, "Customer selections", "Mix sizes and colors");
  await page.locator("#combo-price").fill("3500");
  await expect(
    page.getByRole("button", { name: "Add product to combo" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Add product to combo" }).click();
  await page.getByRole("button", { name: "Add product to combo" }).click();
  await chooseSelectOption(page, "Product 1", fullZip.name);
  await chooseSelectOption(page, "Product 2", halfZip.name);
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Temporary Combo configuration failure",
  );
  expect(productCreateRequests).toBe(1);
  expect(comboConfigurationRequests).toBe(1);
  const retryComboSave = page.getByRole("button", { name: "Save changes" });
  await expect(retryComboSave).toBeEnabled();
  await retryComboSave.click();
  await expect(page).toHaveURL(/\/admin\/catalog\/[0-9a-f-]+\/edit$/);
  expect(productCreateRequests).toBe(1);
  expect(comboConfigurationRequests).toBe(2);

  await page.locator("#catalog-media-file").setInputFiles({
    name: "combo-cover.png",
    mimeType: "image/png",
    buffer: brandPng,
  });
  await page
    .getByLabel("Alt text for combo-cover.png")
    .fill(`${comboName} set`);
  await page.getByRole("button", { name: "Upload images" }).click();
  await expect(
    page.getByRole("button", { name: "Delete image 1" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Published on the storefront").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  const publishedComboResponse = await page.request.get(
    `/api/v1/catalog/products/${comboSlug}`,
  );
  expect(publishedComboResponse.status()).toBe(200);
  const publishedCombo = await publishedComboResponse.json();
  expect(publishedCombo).toMatchObject({
    productType: "combo",
    isPublished: true,
    combo: {
      selectionMode: "mix_sizes_and_colors",
      price: { amountBdt: 3500 },
    },
  });
  const [fullZipComponent, halfZipComponent] = publishedCombo.combo.components;
  expect([fullZipComponent.productName, halfZipComponent.productName]).toEqual([
    fullZip.name,
    halfZip.name,
  ]);

  const customerContext = await browser.newContext({ baseURL: origin });
  try {
    const customerPage = await customerContext.newPage();
    const cartLoad = customerPage.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith("/api/v1/cart"),
    );
    await customerPage.goto(`/shop/products/${comboSlug}`);
    await expect(
      customerPage.getByRole("heading", { name: comboName, level: 1 }),
    ).toBeVisible();
    expect((await cartLoad).status()).toBe(200);

    const fullZipCard = customerPage.getByRole("region", {
      name: fullZip.name,
    });
    await fullZipCard.getByRole("button", { name: "M", exact: true }).click();
    await fullZipCard
      .getByRole("button", { name: "Navy", exact: true })
      .click();
    await fullZipCard.getByRole("button", { name: "L", exact: true }).click();
    await fullZipCard
      .getByRole("button", { name: "Black", exact: true })
      .click();
    await fullZipCard.getByRole("button", { name: "M", exact: true }).click();
    const navyButton = fullZipCard.getByRole("button", {
      name: "Navy",
      exact: true,
    });
    await expect(navyButton).toHaveAttribute("aria-pressed", "true");
    await navyButton.click();
    await expect(navyButton).toHaveAttribute("aria-pressed", "false");
    await navyButton.click();

    const halfZipCard = customerPage.getByRole("region", {
      name: halfZip.name,
    });
    await halfZipCard.getByRole("button", { name: "S", exact: true }).click();
    await halfZipCard
      .getByRole("button", { name: "White", exact: true })
      .click();

    const addComboResponsePromise = customerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/cart/combos"),
    );
    await customerPage.getByRole("button", { name: "Add to cart" }).click();
    const addComboResponse = await addComboResponsePromise;
    expect(addComboResponse.status()).toBe(201);
    expect(addComboResponse.request().postDataJSON()).toMatchObject({
      productId: publishedCombo.id,
      comboRevision: publishedCombo.combo.revision,
      selections: [
        {
          componentId: fullZipComponent.id,
          variantId: fullZip.variants.get("Navy/M")?.id,
        },
        {
          componentId: halfZipComponent.id,
          variantId: halfZip.variants.get("White/S")?.id,
        },
      ],
    });
    await expect(
      customerPage.getByText("Combo added to your cart."),
    ).toBeVisible();
    await customerPage.getByRole("link", { name: "Checkout" }).click();
    await expect(customerPage).toHaveURL(/\/checkout$/);

    const quotePromise = customerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/quotes"),
    );
    await chooseSelectOption(customerPage, "Division", "ঢাকা বিভাগ");
    await chooseSelectOption(customerPage, "District", "ঢাকা জেলা");
    const quoteResponse = await quotePromise;
    expect(quoteResponse.status()).toBe(201);
    const quote = await quoteResponse.json();
    expect(quote.comboGroups).toHaveLength(1);
    expect(quote.comboGroups[0]).toMatchObject({
      productId: publishedCombo.id,
      quantity: 1,
      unitPriceBdt: 3500,
      grossAmountBdt: 3500,
    });
    await customerPage
      .getByLabel("Full name")
      .fill("Combo Integration Customer");
    await customerPage.getByLabel("Mobile number").fill("01712345678");
    await customerPage
      .getByLabel("Delivery address")
      .fill("House 12, Road 5, beside the park");
    const orderResponsePromise = customerPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/orders"),
    );
    await customerPage.getByRole("button", { name: "Place COD order" }).click();
    const orderResponse = await orderResponsePromise;
    expect(orderResponse.status()).toBe(201);
    const createdOrder = await orderResponse.json();
    await expect(customerPage).toHaveURL(`/orders/${createdOrder.id}`);

    const orderDetailsResponse = await page.request.get(
      `/api/v1/orders/manage/${createdOrder.id}`,
    );
    expect(orderDetailsResponse.status()).toBe(200);
    const orderDetails = await orderDetailsResponse.json();
    expect(orderDetails).toMatchObject({
      paymentMethod: "cod",
      status: "pending",
      merchandiseGrossBdt: 3500,
      comboGroups: [{ productId: publishedCombo.id, quantity: 1 }],
    });
    expect(orderDetails.lines).toHaveLength(2);
    for (const variantId of [
      fullZip.variants.get("Navy/M")!.id,
      halfZip.variants.get("White/S")!.id,
    ]) {
      const stockResponse = await page.request.get(
        `/api/v1/inventory/manage/${variantId}`,
      );
      expect(stockResponse.status()).toBe(200);
      expect(await stockResponse.json()).toMatchObject({
        quantityOnHand: 5,
        quantityReserved: 1,
        quantityAvailable: 4,
      });
    }

    const confirmResponse = await page.request.patch(
      `/api/v1/orders/manage/${createdOrder.id}/status`,
      {
        headers: { Origin: origin },
        data: { status: "confirmed" },
      },
    );
    expect(confirmResponse.status()).toBe(200);
    const dispatchResponse = await page.request.post(
      `/api/v1/orders/manage/${createdOrder.id}/dispatch`,
      {
        headers: { Origin: origin, "Idempotency-Key": randomUUID() },
        data: {
          deliveryProvider: "manual",
          deliveryOperator: "E2E delivery team",
          handoffReference: `COMBO-${suffix}`,
        },
      },
    );
    expect(dispatchResponse.status()).toBe(201);

    await page.goto(`/admin/orders/${createdOrder.id}`);
    await expect(page.getByLabel("Combo delivery note")).toHaveCount(0);
    await expect(
      page.getByText(
        "Record the overall delivery outcome first, then record the received quantities for each Combo.",
      ),
    ).toBeVisible();
    const groupId = orderDetails.comboGroups[0].id as string;
    const prematureComboOutcome = await page.request.post(
      `/api/v1/orders/manage/${createdOrder.id}/combo-fulfillment-outcome`,
      {
        headers: { Origin: origin },
        data: {
          groupId,
          outcome: "incomplete",
          reason: "Premature outcome integration check",
          acceptedComponents: [
            { componentId: fullZipComponent.id, quantity: 1 },
          ],
        },
      },
    );
    expect(prematureComboOutcome.status()).toBe(409);
    const deliveryOutcomeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(
            `/api/v1/orders/manage/${createdOrder.id}/fulfillment-outcome`,
          ),
    );
    await page
      .getByRole("textbox", { name: /Verification note/ })
      .fill("The courier delivered only part of the Combo order.");
    await page
      .getByRole("button", { name: "Record Partially Delivered" })
      .click();
    const deliveryOutcomeResponse = await deliveryOutcomeResponsePromise;
    expect(deliveryOutcomeResponse.status()).toBe(201);
    await expect(page.getByLabel("Combo delivery note")).toBeVisible();
    await expect(page.getByText("৳3,500", { exact: true })).toBeVisible();
    await page
      .getByLabel("Combo delivery note")
      .fill("Customer received one item; the other item was unavailable.");
    await page.getByLabel(`Received quantity for ${fullZip.name}`).fill("1");
    await page.getByLabel(`Received quantity for ${halfZip.name}`).fill("0");
    const partialOutcomeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(
            `/api/v1/orders/manage/${createdOrder.id}/combo-fulfillment-outcome`,
          ),
    );
    await page.getByRole("button", { name: "Record incomplete" }).click();
    const partialOutcomeResponse = await partialOutcomeResponsePromise;
    const partialOutcomeBody = await partialOutcomeResponse.text();
    expect(partialOutcomeResponse.status(), partialOutcomeBody).toBe(201);
    const partialOrder = JSON.parse(partialOutcomeBody);
    const partialGroup = partialOrder.comboGroups[0];
    expect(partialGroup).toMatchObject({
      deliveryOutcome: "incomplete",
      outcomeReason:
        "Customer received one item; the other item was unavailable.",
      acceptedComponents: [{ componentId: fullZipComponent.id, quantity: 1 }],
    });
    const acceptedSourcePrice = fullZip.variants.get("Navy/M")!.priceBdt;
    expect(partialOrder.codAmountDueBdt).toBe(
      acceptedSourcePrice + quote.delivery.grossAmountBdt,
    );
    expect(partialOrder.codAmountDueBdt).toBeLessThan(orderDetails.totalBdt);

    const customerOrderResponse = await customerPage.request.get(
      `/api/v1/orders/${createdOrder.id}`,
    );
    expect(customerOrderResponse.status()).toBe(200);
    expect(await customerOrderResponse.json()).toMatchObject({
      codAmountDueBdt: partialOrder.codAmountDueBdt,
      comboGroups: [{ deliveryOutcome: "incomplete" }],
    });
  } finally {
    await customerContext.close();
  }
});
