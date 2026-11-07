import { expect, test } from "@playwright/test";
import type { Order } from "@aaraj/contracts";

test("product views push ecommerce data and an event ID to GTM", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
  });

  await page.goto("/shop/products/media-e2e-fixture");
  await expect(
    page.getByRole("heading", { name: "Media E2E fixture", level: 1 }),
  ).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const dataLayer = (window as Window & { dataLayer?: unknown[] })
          .dataLayer;
        return Array.isArray(dataLayer)
          ? dataLayer.filter(
              (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                "event" in entry &&
                entry.event === "view_item",
            ).length
          : 0;
      }),
    )
    .toBe(1);

  const viewItemEvent = await page.evaluate(() => {
    const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer;
    return Array.isArray(dataLayer)
      ? dataLayer.find(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "event" in entry &&
            entry.event === "view_item",
        )
      : null;
  });

  expect(viewItemEvent).toMatchObject({
    event: "view_item",
    ecommerce: {
      currency: "BDT",
      items: [
        {
          item_id: "6bdb0de0-08da-497d-8c95-173875a9eaa5",
          item_name: "Media E2E fixture",
          quantity: 1,
        },
      ],
    },
  });
  expect(viewItemEvent).toMatchObject({
    event_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
  });
});

test("customer order details do not emit Purchase", async ({ page }) => {
  const orderId = "b7e38a23-2ef7-49f0-a30f-8c25877e631e";
  let order: Order = {
    id: orderId,
    reference: "ORD-026-00001",
    currency: "BDT",
    status: "pending",
    paymentMethod: "cod",
    collectionStatus: "uncollected",
    collectedAmountBdt: null,
    fulfillmentStatus: "not_started",
    courierHandoff: null,
    lines: [
      {
        variantId: "0d8c92cf-d31c-4ca7-9c99-4aad8e103565",
        productName: "Test shirt",
        color: "Blue",
        sizeLabel: "M",
        quantity: 1,
        unitPriceBdt: 250,
        compareAtPriceBdt: null,
        grossAmountBdt: 250,
      },
    ],
    merchandiseGrossBdt: 250,
    delivery: {
      tariffVersion: "TEST_DELIVERY_V1",
      effectiveFrom: "2026-10-08",
      zone: null,
      grossAmountBdt: 80,
    },
    totalBdt: 330,
    codAmountDueBdt: 330,
    cancellationReason: null,
    cancelledAt: null,
    address: {
      recipientName: "Test Recipient",
      phone: "+8801712345678",
      geographyVersion: "TEST_BD_V1",
      divisionId: "5a4cf93c-c6ed-4bcb-8f4a-73db80e4896d",
      divisionName: "Dhaka",
      districtId: "2a1dc97b-b8b4-47e3-a1db-1a5d2c7bcffc",
      districtName: "Dhaka",
      upazilaId: null,
      upazilaName: null,
      doorstepDetails: "House 12, Road 5",
      street: null,
      house: null,
      postalCode: null,
      instructions: null,
    },
    createdAt: "2026-10-01T12:00:00.000Z",
    guestAccessExpiresAt: "2026-10-31T12:00:00.000Z",
  };

  await page.addInitScript(() => {
    (window as Window & { dataLayer?: unknown[] }).dataLayer = [];
  });
  await page.route(`**/api/v1/orders/${orderId}`, (route) =>
    route.fulfill({ status: 200, json: order }),
  );

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-reference")).toHaveText("ORD-026-00001");

  const purchaseEventCount = () =>
    page.evaluate(() => {
      const dataLayer = (window as Window & { dataLayer?: unknown[] })
        .dataLayer;
      return Array.isArray(dataLayer)
        ? dataLayer.filter(
            (entry) =>
              typeof entry === "object" &&
              entry !== null &&
              "event" in entry &&
              entry.event === "purchase",
          ).length
        : 0;
    });

  expect(await purchaseEventCount()).toBe(0);

  order = { ...order, status: "no_answer" };
  await page.reload();
  await expect(page.getByTestId("order-reference")).toHaveText("ORD-026-00001");
  expect(await purchaseEventCount()).toBe(0);

  order = { ...order, status: "on_hold" };
  await page.reload();
  await expect(page.getByTestId("order-reference")).toHaveText("ORD-026-00001");
  expect(await purchaseEventCount()).toBe(0);

  order = {
    ...order,
    status: "confirmed",
    fulfillmentStatus: "awaiting_dispatch",
  };
  await page.reload();
  await expect(page.getByTestId("order-reference")).toHaveText("ORD-026-00001");
  expect(await purchaseEventCount()).toBe(0);
});
