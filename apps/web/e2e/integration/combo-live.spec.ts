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
    sizes?: string[];
    priceBdt: number;
  },
): Promise<SourceProduct> {
  const sizes = input.sizes ?? ["S", "M", "L"];
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

async function createDraftSourceProduct(
  page: import("@playwright/test").Page,
  input: {
    suffix: string;
    name: string;
    categoryId: string;
    sizeGuideId: string;
    color: string;
    priceBdt: number;
    stockQuantity: number;
  },
): Promise<SourceProduct> {
  const variants = ["S", "M", "L"].map((sizeLabel) => ({
    sku: `E2E-${input.suffix}-${input.color.toUpperCase()}-${sizeLabel}`,
    color: input.color,
    sizeLabel,
    price: { amountBdt: input.priceBdt },
    compareAtPrice: { amountBdt: input.priceBdt + 300 },
  }));
  const createdResponse = await page.request.post("/api/v1/catalog/products", {
    headers: { Origin: origin },
    data: {
      productType: "single",
      slug: `${input.suffix}-source`,
      name: input.name,
      description: `${input.name} is an unpublished inventory source for Combo coverage.`,
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
  const managedResponse = await page.request.get(
    `/api/v1/catalog/products/manage/${createdProduct.id}`,
  );
  expect(managedResponse.status()).toBe(200);
  const managed = await managedResponse.json();
  const variantByOption = new Map<string, { id: string; priceBdt: number }>();
  for (const variant of managed.variants as Array<{
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
          delta: input.stockQuantity,
          reason: "Seed unpublished Combo source inventory",
        },
      },
    );
    expect(stockResponse.status()).toBe(201);
  }
  return {
    id: managed.id,
    name: managed.name,
    variants: variantByOption,
  };
}

async function createPublishedCombo(
  page: import("@playwright/test").Page,
  input: {
    suffix: string;
    name: string;
    slug: string;
    categoryId: string;
    sizeGuideId: string;
    itemCount?: number;
    selectionMode:
      "fixed_combo" | "mix_colors_one_size" | "mix_sizes_and_colors";
    components: Array<{ productId: string; fixedColor: string | null }>;
    priceBdt: number;
  },
) {
  const createdResponse = await page.request.post("/api/v1/catalog/products", {
    headers: { Origin: origin },
    data: {
      productType: "combo",
      slug: input.slug,
      name: input.name,
      description: `${input.name} for the isolated browser integration journey.`,
      audience: "unisex",
      categoryId: input.categoryId,
      fit: "Regular",
      sizeGuideId: input.sizeGuideId,
      isPublished: false,
    },
  });
  expect(createdResponse.status()).toBe(201);
  const createdProduct = await createdResponse.json();
  const productManageResponse = await page.request.get(
    `/api/v1/catalog/products/manage/${createdProduct.id}`,
  );
  expect(productManageResponse.status()).toBe(200);
  const etag = productManageResponse.headers().etag;
  expect(etag).toBeTruthy();

  const configureResponse = await page.request.put(
    `/api/v1/catalog/combos/manage/${createdProduct.id}`,
    {
      headers: { Origin: origin, "If-Match": etag! },
      data: {
        selectionMode: input.selectionMode,
        ...(input.itemCount === undefined
          ? {}
          : { itemCount: input.itemCount }),
        price: { amountBdt: input.priceBdt },
        components: input.components,
      },
    },
  );
  expect(configureResponse.status()).toBe(200);

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

  const latestProduct = await page.request.get(
    `/api/v1/catalog/products/manage/${createdProduct.id}`,
  );
  expect(latestProduct.status()).toBe(200);
  const publishResponse = await page.request.patch(
    `/api/v1/catalog/products/${createdProduct.id}`,
    {
      headers: {
        Origin: origin,
        "If-Match": latestProduct.headers().etag!,
      },
      data: { isPublished: true },
    },
  );
  expect(publishResponse.status()).toBe(200);

  const publicResponse = await page.request.get(
    `/api/v1/catalog/products/${input.slug}`,
  );
  expect(publicResponse.status()).toBe(200);
  return publicResponse.json();
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
        {
          sizeLabel: "XXL",
          measurements: [{ key: "chest_width", value: "26.0" }],
        },
      ],
    },
  });
  expect(guideResponse.status()).toBe(201);
  const guide = await guideResponse.json();

  const [fullZip, halfZip] = await Promise.all([
    createPublishedSourceProduct(page, {
      suffix: `${suffix}-full`,
      name: `E2E Full Zip ${suffix}`,
      categoryId: category.id,
      sizeGuideId: guide.id,
      colors: ["Navy", "Black"],
      sizes: ["S", "M", "L", "XXL"],
      priceBdt: 2200,
    }),
    createPublishedSourceProduct(page, {
      suffix: `${suffix}-half`,
      name: `E2E Half Zip ${suffix}`,
      categoryId: category.id,
      sizeGuideId: guide.id,
      colors: ["White", "Red"],
      priceBdt: 1800,
    }),
  ]);
  const [hoodie, polo] = await Promise.all([
    createPublishedSourceProduct(page, {
      suffix: `${suffix}-hoodie`,
      name: `E2E Hoodie ${suffix}`,
      categoryId: category.id,
      sizeGuideId: guide.id,
      colors: ["Olive", "Coffee"],
      priceBdt: 1600,
    }),
    createPublishedSourceProduct(page, {
      suffix: `${suffix}-polo`,
      name: `E2E Polo ${suffix}`,
      categoryId: category.id,
      sizeGuideId: guide.id,
      colors: ["Green", "Black"],
      priceBdt: 1400,
    }),
  ]);
  const tee = await createPublishedSourceProduct(page, {
    suffix: `${suffix}-tee`,
    name: `E2E Tee ${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    colors: ["Maroon", "White"],
    priceBdt: 1200,
  });
  const sourceProducts = [fullZip, halfZip, hoodie, polo, tee];
  const blackMediumVariant = fullZip.variants.get("Black/M");
  if (!blackMediumVariant)
    throw new Error("The black M source variant is missing.");
  const soldOutAdjustment = await page.request.post(
    `/api/v1/inventory/manage/${blackMediumVariant.id}/adjustments`,
    {
      headers: { Origin: origin },
      data: {
        commandId: randomUUID(),
        delta: -5,
        reason: "Seed a sold-out option for Combo integration coverage",
      },
    },
  );
  expect(soldOutAdjustment.status()).toBe(201);
  const soldOutSmallVariants = sourceProducts.flatMap((source) => {
    const smallVariants = [...source.variants.entries()].filter(([key]) =>
      key.endsWith("/S"),
    );
    expect(smallVariants.length).toBeGreaterThan(0);
    return smallVariants.map(([, variant]) => variant);
  });
  const soldOutSmallResponses = await Promise.all(
    soldOutSmallVariants.map((sizeSVariant) =>
      page.request.post(
        `/api/v1/inventory/manage/${sizeSVariant.id}/adjustments`,
        {
          headers: { Origin: origin },
          data: {
            commandId: randomUUID(),
            delta: -5,
            reason: "Seed sold-out size coverage in isolated Combo browser E2E",
          },
        },
      ),
    ),
  );
  for (const response of soldOutSmallResponses) {
    expect(response.status()).toBe(201);
  }

  const comboName = `E2E Three Piece Combo ${suffix}`;
  const comboSlug = `e2e-three-piece-combo-${suffix}`;
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
  await page.route(
    "**/api/v1/catalog/combos/manage/candidates**",
    async (route) => {
      const response = await route.fetch();
      const candidates = (await response.json()) as Array<{ id: string }>;
      await route.fulfill({
        response,
        json: candidates.filter(({ id }) =>
          sourceProducts.some((source) => source.id === id),
        ),
      });
    },
  );
  await page.goto("/admin/catalog/create");
  await chooseSelectOption(page, "Product type", "Combo");
  await page.getByLabel("Name", { exact: true }).fill(comboName);
  await page.locator("#product-slug").fill(comboSlug);
  await page
    .getByLabel("Description", { exact: true })
    .fill("A three piece Combo created in a real admin and customer journey.");
  await chooseSelectOption(page, "Audience", "Unisex");
  await chooseSelectOption(page, "Product category", category.name);
  await page
    .getByRole("combobox", { name: "Combo size guide (optional)" })
    .click();
  await page.getByRole("option").filter({ hasText: guide.name }).click();
  await chooseSelectOption(page, "Customer selections", "Mix sizes and colors");
  await page.getByLabel("Items in combo", { exact: true }).fill("3");
  await page.locator("#combo-price").fill("3500");
  const comboItems = page.getByRole("group", { name: "Combo items" });
  await expect(comboItems).toContainText("No items added yet.");
  await page.getByLabel("Search products to add").fill(fullZip.name);
  await page
    .getByRole("button", { name: `Add ${fullZip.name} to combo` })
    .click();
  await expect(comboItems).toContainText(fullZip.name);
  await expect(comboItems).toContainText("2 colors · 4 sizes · 8 variants");
  for (const source of sourceProducts.slice(1)) {
    await page.getByLabel("Search products to add").fill(source.name);
    await page
      .getByRole("button", { name: `Add ${source.name} to combo` })
      .click();
    await expect(comboItems).toContainText(source.name);
  }
  await expect(comboItems).not.toContainText(fullZip.id);
  await expect(comboItems).not.toContainText(halfZip.id);
  await chooseSelectOption(page, "Customer selections", "Fixed combo");
  await expect(comboItems).toContainText("Products in this combo");
  await expect(
    comboItems.getByRole("combobox", { name: "Fixed color" }),
  ).toHaveCount(sourceProducts.length);
  await expect(
    page.getByLabel("Items in combo", { exact: true }),
  ).toBeDisabled();
  for (const [index, color] of [
    "Navy",
    "White",
    "Olive",
    "Green",
    "Maroon",
  ].entries()) {
    const fixedColor = comboItems
      .getByRole("combobox", {
        name: "Fixed color",
      })
      .nth(index);
    await fixedColor.click();
    await page.getByRole("option", { name: color, exact: true }).click();
  }
  await page.getByLabel("Search products to add").fill(fullZip.name);
  await page
    .getByRole("button", {
      name: `Add another ${fullZip.name} to combo`,
    })
    .click();
  await expect(
    comboItems.getByRole("combobox", { name: "Fixed color" }),
  ).toHaveCount(sourceProducts.length + 1);
  await comboItems.getByRole("button", { name: "Remove combo item 6" }).click();
  await chooseSelectOption(page, "Customer selections", "Mix colors, one size");
  await expect(comboItems).toContainText("Products customers can choose from");
  await expect(
    comboItems.getByRole("combobox", { name: "Fixed color" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Items in combo", { exact: true }),
  ).toBeEnabled();
  await chooseSelectOption(page, "Customer selections", "Mix sizes and colors");
  await page.getByLabel("Items in combo", { exact: true }).fill("3");
  await expect(
    page.getByRole("combobox", { name: "Customer selections" }),
  ).toContainText("Mix sizes and colors");
  await expect(
    page.getByRole("combobox", { name: "Customer selections" }),
  ).not.toContainText("mix_sizes_and_colors");
  await page.getByLabel("Search products to add").fill(halfZip.name);
  await expect(
    page.getByRole("button", { name: `Add ${halfZip.name} to combo` }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Create combo draft" }).click();
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
  expect(publishedCombo.sizeGuide.id).toBe(guide.id);
  const publicNavyMedium = publishedCombo.combo.components[0].variants.find(
    (variant: { color: string; sizeLabel: string }) =>
      variant.color === "Navy" && variant.sizeLabel === "M",
  );
  expect(publicNavyMedium?.availableQuantity).toBe(3);
  const [fullZipComponent, halfZipComponent] = publishedCombo.combo.components;
  expect(
    publishedCombo.combo.components.map(
      (component: { productName: string }) => component.productName,
    ),
  ).toEqual(sourceProducts.map(({ name }) => name));
  for (const [index, component] of publishedCombo.combo.components.entries()) {
    const thumbnail = component.thumbnails?.find(
      ({ color }: { color: string | null }) => color === null,
    );
    const source = sourceProducts[index];
    if (!thumbnail || !source) {
      throw new Error("The published combo source thumbnail is missing.");
    }
    expect(thumbnail.altText).toBe(`${source.name} product image`);
    expect(thumbnail.card.src).toMatch(
      /^\/api\/v1\/catalog\/media\/.+\/card\/[a-f0-9]{64}\.webp$/,
    );
    const thumbnailResponse = await page.request.get(thumbnail.card.src);
    expect(thumbnailResponse.status()).toBe(200);
    expect(thumbnailResponse.headers()["content-type"]).toContain("image/webp");
  }
  expect(publishedCombo.combo.itemCount).toBe(3);

  const fixedCombo = await createPublishedCombo(page, {
    suffix: `${suffix}-fixed`,
    name: `E2E Fixed Combo ${suffix}`,
    slug: `e2e-fixed-combo-${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    selectionMode: "fixed_combo",
    components: [
      { productId: fullZip.id, fixedColor: "Navy" },
      { productId: halfZip.id, fixedColor: "Red" },
      { productId: hoodie.id, fixedColor: "Olive" },
    ],
    priceBdt: 3200,
  });
  const mixColorsCombo = await createPublishedCombo(page, {
    suffix: `${suffix}-mix-colors`,
    name: `E2E Mix Colors Combo ${suffix}`,
    slug: `e2e-mix-colors-combo-${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    itemCount: 3,
    selectionMode: "mix_colors_one_size",
    components: sourceProducts.map(({ id }) => ({
      productId: id,
      fixedColor: null,
    })),
    priceBdt: 3300,
  });
  expect(fixedCombo.combo.selectionMode).toBe("fixed_combo");
  expect(mixColorsCombo.combo.selectionMode).toBe("mix_colors_one_size");

  const unpublishedSource = await createDraftSourceProduct(page, {
    suffix: `${suffix}-hidden-source`,
    name: `E2E Unpublished Source ${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    color: "Black",
    priceBdt: 900,
    stockQuantity: 1,
  });
  const repeatedFixedCombo = await createPublishedCombo(page, {
    suffix: `${suffix}-repeated-fixed`,
    name: `E2E Repeated Fixed Combo ${suffix}`,
    slug: `e2e-repeated-fixed-combo-${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    selectionMode: "fixed_combo",
    components: [
      { productId: unpublishedSource.id, fixedColor: "Black" },
      { productId: unpublishedSource.id, fixedColor: "Black" },
    ],
    priceBdt: 1500,
  });
  expect(repeatedFixedCombo).toMatchObject({
    isPublished: true,
    inStock: false,
    combo: { itemCount: 2, selectionMode: "fixed_combo" },
  });
  const [repeatedFirst, repeatedSecond] = repeatedFixedCombo.combo.components;
  const repeatedMediumVariant = unpublishedSource.variants.get("Black/M")!;
  const repeatedSelection = {
    revision: 0,
    productId: repeatedFixedCombo.id,
    comboRevision: repeatedFixedCombo.combo.revision,
    selections: [
      { componentId: repeatedFirst.id, variantId: repeatedMediumVariant.id },
      { componentId: repeatedSecond.id, variantId: repeatedMediumVariant.id },
    ],
    quantity: 1,
  };
  const isolatedCartContext = await browser.newContext({ baseURL: origin });
  try {
    const rejectedUnderstockedSet = await isolatedCartContext.request.post(
      "/api/v1/cart/combos",
      { headers: { Origin: origin }, data: repeatedSelection },
    );
    expect(rejectedUnderstockedSet.status()).toBe(422);
    expect(await rejectedUnderstockedSet.json()).toMatchObject({
      errorCode: "COMBO_VARIANT_UNAVAILABLE",
    });

    const addOneMoreMedium = await page.request.post(
      `/api/v1/inventory/manage/${repeatedMediumVariant.id}/adjustments`,
      {
        headers: { Origin: origin },
        data: {
          commandId: randomUUID(),
          delta: 1,
          reason: "Complete stock for the repeated fixed Combo",
        },
      },
    );
    expect(addOneMoreMedium.status()).toBe(201);
    const acceptedRepeatedSet = await isolatedCartContext.request.post(
      "/api/v1/cart/combos",
      { headers: { Origin: origin }, data: repeatedSelection },
    );
    expect(acceptedRepeatedSet.status()).toBe(201);
    expect((await acceptedRepeatedSet.json()).combos[0]).toMatchObject({
      productId: repeatedFixedCombo.id,
      availability: "available",
    });
  } finally {
    await isolatedCartContext.close();
  }

  const singleSourceFlexibleCombo = await createPublishedCombo(page, {
    suffix: `${suffix}-one-source-mix`,
    name: `E2E One Source Flexible Combo ${suffix}`,
    slug: `e2e-one-source-flexible-combo-${suffix}`,
    categoryId: category.id,
    sizeGuideId: guide.id,
    itemCount: 3,
    selectionMode: "mix_sizes_and_colors",
    components: [{ productId: unpublishedSource.id, fixedColor: null }],
    priceBdt: 2100,
  });
  expect(singleSourceFlexibleCombo).toMatchObject({
    isPublished: true,
    inStock: true,
    combo: {
      itemCount: 3,
      selectionMode: "mix_sizes_and_colors",
      components: [{ productId: unpublishedSource.id }],
    },
  });

  const fixedCustomerContext = await browser.newContext({ baseURL: origin });
  try {
    const fixedPage = await fixedCustomerContext.newPage();
    await fixedPage.goto(`/shop/products/${fixedCombo.slug}`);
    await expect(
      fixedPage.getByRole("heading", { name: fixedCombo.name, level: 1 }),
    ).toBeVisible();
    await expect(
      fixedPage.getByRole("heading", { name: "Size guide", level: 3 }),
    ).toBeVisible();
    const sharedSize = fixedPage.getByRole("group", {
      name: "Size for the whole set",
    });
    const fixedAddButton = fixedPage.getByRole("button", {
      name: "Add to cart",
      exact: true,
    });
    await expect(fixedAddButton).toBeDisabled();
    await expect(
      sharedSize.getByRole("button", { name: "Choose size S", exact: true }),
    ).toBeDisabled();
    await sharedSize
      .getByRole("button", { name: "Choose size M", exact: true })
      .click();
    await expect(fixedAddButton).toBeEnabled();

    const addFixedResponsePromise = fixedPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/cart/combos"),
    );
    await fixedAddButton.click();
    const addFixedResponse = await addFixedResponsePromise;
    expect(addFixedResponse.status()).toBe(201);
    const [fixedFullComponent, fixedHalfComponent, fixedHoodieComponent] =
      fixedCombo.combo.components;
    expect(addFixedResponse.request().postDataJSON()).toMatchObject({
      productId: fixedCombo.id,
      selections: [
        {
          componentId: fixedFullComponent.id,
          variantId: fullZip.variants.get("Navy/M")?.id,
        },
        {
          componentId: fixedHalfComponent.id,
          variantId: halfZip.variants.get("Red/M")?.id,
        },
        {
          componentId: fixedHoodieComponent.id,
          variantId: hoodie.variants.get("Olive/M")?.id,
        },
      ],
    });
    const fixedCartResponse = await fixedPage.request.get("/api/v1/cart");
    expect(fixedCartResponse.status()).toBe(200);
    expect((await fixedCartResponse.json()).combos[0]).toMatchObject({
      productId: fixedCombo.id,
      comboRevision: fixedCombo.combo.revision,
      selections: [
        {
          componentId: fixedFullComponent.id,
          variantId: fullZip.variants.get("Navy/M")?.id,
        },
        {
          componentId: fixedHalfComponent.id,
          variantId: halfZip.variants.get("Red/M")?.id,
        },
        {
          componentId: fixedHoodieComponent.id,
          variantId: hoodie.variants.get("Olive/M")?.id,
        },
      ],
    });
  } finally {
    await fixedCustomerContext.close();
  }

  const mixColorsCustomerContext = await browser.newContext({
    baseURL: origin,
  });
  try {
    const mixColorsPage = await mixColorsCustomerContext.newPage();
    await mixColorsPage.goto(`/shop/products/${mixColorsCombo.slug}`);
    await expect(
      mixColorsPage.getByRole("heading", {
        name: mixColorsCombo.name,
        level: 1,
      }),
    ).toBeVisible();
    const mixColorsProductRegion = mixColorsPage.getByRole("region", {
      name: mixColorsCombo.name,
      exact: true,
    });
    await expect(
      mixColorsProductRegion.getByRole("deletion").first(),
    ).toHaveText("৳3,600");
    await expect(
      mixColorsProductRegion.getByText("From", { exact: true }),
    ).toHaveCount(0);
    const mixAddButton = mixColorsPage.getByRole("button", {
      name: "Add to cart",
      exact: true,
    });
    await expect(mixAddButton).toBeDisabled();
    const sharedSize = mixColorsPage.getByRole("group", {
      name: "One size for the whole set",
    });
    const soldOutSmall = sharedSize.getByRole("button", {
      name: "Choose size S",
      exact: true,
    });
    await expect(soldOutSmall).toBeDisabled();
    await sharedSize
      .getByRole("button", { name: "Choose size M", exact: true })
      .click();
    const mixFullCard = mixColorsPage.getByRole("region", {
      name: fullZip.name,
    });
    const unavailableBlackMedium = mixFullCard.getByRole("article", {
      name: `${fullZip.name}, Black, size M, unavailable`,
    });
    await expect(unavailableBlackMedium).toBeVisible();
    await expect(mixFullCard.getByText("Sold out")).toHaveCount(0);
    await expect(
      mixFullCard.getByRole("button", {
        name: `Add one ${fullZip.name} Black size M`,
      }),
    ).toHaveCount(0);
    const addNavy = mixFullCard.getByRole("button", {
      name: `Add one ${fullZip.name} Navy size M`,
    });
    await addNavy.click();
    await mixFullCard
      .getByRole("button", {
        name: `Remove one ${fullZip.name} Navy size M`,
      })
      .click();
    await addNavy.click();
    await addNavy.click();
    const mixHalfCard = mixColorsPage.getByRole("region", {
      name: halfZip.name,
    });
    await mixHalfCard
      .getByRole("button", {
        name: `Add one ${halfZip.name} Red size M`,
      })
      .click();
    await expect(addNavy).toBeDisabled();
    await expect(mixAddButton).toBeEnabled();
    await expect(
      mixColorsPage.getByText("Choose 3 items in M · 3 selected"),
    ).toBeVisible();
    await expect(
      mixColorsProductRegion.getByRole("deletion").first(),
    ).toHaveText("৳6,200");
    const mixHoodieCard = mixColorsPage.getByRole("region", {
      name: hoodie.name,
    });
    await expect(
      mixHoodieCard.getByRole("button", {
        name: `Add one ${hoodie.name} Olive size M`,
      }),
    ).toBeDisabled();
    await sharedSize
      .getByRole("button", { name: "Choose size L", exact: true })
      .click();
    await expect(mixAddButton).toBeDisabled();
    await sharedSize
      .getByRole("button", { name: "Choose size M", exact: true })
      .click();
    await mixFullCard
      .getByRole("button", {
        name: `Add one ${fullZip.name} Navy size M`,
      })
      .click();
    await mixFullCard
      .getByRole("button", {
        name: `Add one ${fullZip.name} Navy size M`,
      })
      .click();
    await mixHalfCard
      .getByRole("button", {
        name: `Add one ${halfZip.name} Red size M`,
      })
      .click();
    await expect(mixAddButton).toBeEnabled();

    const addMixColorsResponsePromise = mixColorsPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/cart/combos"),
    );
    await mixAddButton.click();
    const addMixColorsResponse = await addMixColorsResponsePromise;
    expect(addMixColorsResponse.status()).toBe(201);
    const mixComponents = mixColorsCombo.combo.components as Array<{
      id: string;
      productId: string;
    }>;
    expect(addMixColorsResponse.request().postDataJSON()).toMatchObject({
      productId: mixColorsCombo.id,
      selections: [
        {
          componentId: mixComponents[0]!.id,
          variantId: fullZip.variants.get("Navy/M")?.id,
        },
        {
          componentId: mixComponents[0]!.id,
          variantId: fullZip.variants.get("Navy/M")?.id,
        },
        {
          componentId: mixComponents[1]!.id,
          variantId: halfZip.variants.get("Red/M")?.id,
        },
      ],
    });
  } finally {
    await mixColorsCustomerContext.close();
  }

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
    const actualComboPrice = customerPage.getByText("3,500").first();
    await expect(actualComboPrice).toBeVisible();
    await expect(
      customerPage.getByRole("heading", { name: "Size guide", level: 3 }),
    ).toBeVisible();
    expect((await cartLoad).status()).toBe(200);

    const fullZipCard = customerPage.getByRole("region", {
      name: fullZip.name,
    });
    const halfZipCard = customerPage.getByRole("region", {
      name: halfZip.name,
    });
    const mixColors = customerPage.getByRole("group", {
      name: /^Color/,
    });
    await expect(
      mixColors.getByRole("button", { name: "Choose color Black" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      customerPage.getByText("(Choose 3 items across colors and sizes)"),
    ).toBeVisible();
    const unavailableBlackMedium = fullZipCard.getByRole("article", {
      name: `${fullZip.name}, Black, size M, unavailable`,
    });
    await expect(unavailableBlackMedium).toBeVisible();
    await expect(fullZipCard.getByText("Sold out")).toHaveCount(0);
    const addNavyColor = mixColors.getByRole("button", {
      name: "Choose color Navy",
    });
    await addNavyColor.click();
    await expect(fullZipCard).toBeVisible();
    await expect(halfZipCard).toHaveCount(0);
    const addNavyMedium = fullZipCard.getByRole("button", {
      name: `Add one ${fullZip.name} Navy size M`,
    });
    await expect(customerPage.getByText("0 of 3 selected")).toBeVisible();
    await addNavyMedium.click();
    await addNavyMedium.click();
    await expect(customerPage.getByText("2 of 3 selected")).toBeVisible();
    await expect(
      mixColors.getByRole("button", { name: "Choose color Navy, 2 selected" }),
    ).toBeVisible();

    await mixColors.getByRole("button", { name: "Choose color White" }).click();
    await expect(halfZipCard).toBeVisible();
    const addWhiteLarge = halfZipCard.getByRole("button", {
      name: `Add one ${halfZip.name} White size L`,
    });
    await addWhiteLarge.click();
    await expect(customerPage.getByText("3 of 3 selected")).toBeVisible();
    await mixColors
      .getByRole("button", { name: "Choose color Navy, 2 selected" })
      .click();
    await expect(
      fullZipCard.getByRole("button", {
        name: `Remove one ${fullZip.name} Navy size M`,
      }),
    ).toBeEnabled();
    await expect(
      mixColors.getByRole("button", { name: "Choose color White, 1 selected" }),
    ).toBeVisible();
    await expect(customerPage.getByText("Regular/Base price:")).toHaveCount(0);
    await expect(
      customerPage
        .getByRole("region", { name: comboName, exact: true })
        .getByRole("deletion")
        .first(),
    ).toHaveText("৳6,200");
    await expect(actualComboPrice).toBeVisible();

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
          componentId: fullZipComponent.id,
          variantId: fullZip.variants.get("Navy/M")?.id,
        },
        {
          componentId: halfZipComponent.id,
          variantId: halfZip.variants.get("White/L")?.id,
        },
      ],
    });
    await expect(
      customerPage.getByText("Combo added to your cart."),
    ).toBeVisible();
    await customerPage.reload();
    await customerPage.goto("/cart");
    await expect(
      customerPage.getByRole("heading", { name: "Your cart", level: 1 }),
    ).toBeVisible();
    await expect(
      customerPage.getByRole("link", { name: comboName }),
    ).toBeVisible();
    await expect(
      customerPage.getByText(`${fullZip.name} · Navy · M`, { exact: true }),
    ).toHaveCount(2);
    await expect(
      customerPage.getByText(`${halfZip.name} · White · L`, { exact: true }),
    ).toBeVisible();
    await customerPage.goto("/checkout");
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
    expect(orderDetails.lines).toHaveLength(3);
    expect(orderDetails.comboGroups[0].selections).toMatchObject([
      { selectionIndex: 0, variantId: fullZip.variants.get("Navy/M")?.id },
      { selectionIndex: 1, variantId: fullZip.variants.get("Navy/M")?.id },
      { selectionIndex: 2, variantId: halfZip.variants.get("White/L")?.id },
    ]);
    for (const variantId of [
      fullZip.variants.get("Navy/M")!.id,
      halfZip.variants.get("White/L")!.id,
    ]) {
      const stockResponse = await page.request.get(
        `/api/v1/inventory/manage/${variantId}`,
      );
      expect(stockResponse.status()).toBe(200);
      expect(await stockResponse.json()).toMatchObject({
        quantityOnHand: 5,
        quantityReserved:
          variantId === fullZip.variants.get("Navy/M")!.id ? 2 : 1,
        quantityAvailable:
          variantId === fullZip.variants.get("Navy/M")!.id ? 3 : 4,
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
    await page
      .getByLabel(`Received quantity for Combo item 1: ${fullZip.name} Navy M`)
      .fill("0");
    await page
      .getByLabel(`Received quantity for Combo item 2: ${fullZip.name} Navy M`)
      .fill("1");
    await page
      .getByLabel(`Received quantity for Combo item 3: ${halfZip.name} White L`)
      .fill("0");
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
      acceptedComponents: [
        {
          componentId: fullZipComponent.id,
          selectionIndex: 1,
          quantity: 1,
        },
      ],
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

  await page.unroute("**/api/v1/catalog/combos/manage/*");
  let editConfigurationAttempts = 0;
  let editProductUpdateAttempts = 0;
  await page.route(
    `**/api/v1/catalog/combos/manage/${publishedCombo.id}`,
    async (route) => {
      if (route.request().method() === "PUT") {
        editConfigurationAttempts += 1;
        if (editConfigurationAttempts === 1) {
          await route.fulfill({
            status: 503,
            json: {
              statusCode: 503,
              message:
                "Temporary combo configuration failure for edit retry coverage.",
            },
          });
          return;
        }
      }
      await route.continue();
    },
  );
  await page.route(
    `**/api/v1/catalog/products/${publishedCombo.id}`,
    async (route) => {
      if (route.request().method() === "PATCH") {
        editProductUpdateAttempts += 1;
      }
      await route.continue();
    },
  );
  await page.goto(`/admin/catalog/${publishedCombo.id}/edit`);
  await chooseSelectOption(page, "Audience", "Men");
  await page.locator("#combo-price").fill("3600");
  const saveChanges = page.getByRole("button", { name: "Save changes" });
  const firstEditConfiguration = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response
        .url()
        .endsWith(`/api/v1/catalog/combos/manage/${publishedCombo.id}`),
  );
  await saveChanges.click();
  expect((await firstEditConfiguration).status()).toBe(503);
  await expect(
    page.getByText(
      "Temporary combo configuration failure for edit retry coverage.",
    ),
  ).toBeVisible();
  await expect(saveChanges).toBeEnabled();

  const retryEditConfiguration = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response
        .url()
        .endsWith(`/api/v1/catalog/combos/manage/${publishedCombo.id}`),
  );
  await saveChanges.click();
  expect((await retryEditConfiguration).status()).toBe(200);
  expect(editConfigurationAttempts).toBe(2);
  expect(editProductUpdateAttempts).toBe(1);

  const recoveredProductResponse = await page.request.get(
    `/api/v1/catalog/products/${comboSlug}`,
  );
  expect(recoveredProductResponse.status()).toBe(200);
  expect(await recoveredProductResponse.json()).toMatchObject({
    audience: "men",
    combo: { price: { amountBdt: 3600 } },
  });
});
