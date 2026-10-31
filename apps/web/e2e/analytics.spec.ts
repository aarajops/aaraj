import { expect, test } from "@playwright/test";

test("product views push the Meta mapping and event ID to GTM", async ({
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
    meta_event_name: "ViewContent",
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
