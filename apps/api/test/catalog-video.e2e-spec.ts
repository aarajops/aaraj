import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/auth.js";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import {
  catalogProduct,
  catalogProductVariant,
  catalogProductVideo,
  catalogVideoWebhookInbox,
} from "../src/catalog/catalog-schema.js";
import { CloudflareStreamService } from "../src/catalog/media/cloudflare-stream.service.js";

interface Account {
  id: string;
  cookie: string;
}

class MemoryCloudflareStream {
  provisionCalls = 0;
  failNextDelete = false;
  processingState: "inprogress" | "ready" = "inprogress";
  readonly deleted: string[] = [];
  readonly captions = new Map<
    string,
    { language: string; label: string; status: "ready" }[]
  >();

  async createTusUpload(_input: { videoId: string }) {
    this.provisionCalls += 1;
    const providerUid = randomUUID().replaceAll("-", "");
    return {
      uploadUrl: `https://upload.videodelivery.net/${providerUid}`,
      providerUid,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  encryptUploadUrl(uploadUrl: string, videoId: string) {
    return `encrypted:${videoId}:${Buffer.from(uploadUrl).toString("base64url")}`;
  }

  decryptUploadUrl(envelope: string, videoId: string) {
    const prefix = `encrypted:${videoId}:`;
    if (!envelope.startsWith(prefix))
      throw new Error("Envelope context mismatch.");
    return Buffer.from(envelope.slice(prefix.length), "base64url").toString();
  }

  verifyWebhook(_rawBody: Buffer, signature: string | undefined) {
    return signature === "test-signature";
  }

  async getVideo(providerUid: string) {
    return {
      uid: providerUid,
      readyToStream: this.processingState === "ready",
      status: {
        state: this.processingState === "ready" ? "ready" : "inprogress",
        pctComplete: this.processingState === "ready" ? "100" : "40",
      },
      duration: 23.5,
    };
  }

  async getPlaybackUrl(providerUid: string) {
    return `https://iframe.videodelivery.net/signed-${providerUid}`;
  }

  async uploadCaption(providerUid: string, language: string) {
    const captions = [
      {
        language,
        label: language === "bn" ? "বাংলা" : language,
        status: "ready" as const,
      },
    ];
    this.captions.set(providerUid, captions);
    return captions;
  }

  async deleteVideo(providerUid: string) {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("simulated provider deletion failure");
    }
    this.deleted.push(providerUid);
  }
}

const origin = "http://localhost:3000";
const password = "aaraj-catalog-video-e2e-password-123";

describe("catalog video management", () => {
  let app: NestExpressApplication;
  let database: DatabaseService;
  let operator: Account;
  let customer: Account;
  let productId: string;
  let productSlug: string;
  let videoId: string;
  let providerUid: string;
  const stream = new MemoryCloudflareStream();

  async function createAccount(name: string): Promise<Account> {
    const email = `${name}-${randomUUID()}@video-e2e.example`;
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }

  function managedVideos(account = operator) {
    return request(app.getHttpServer())
      .get(`/api/v1/catalog/products/manage/${productId}/videos`)
      .set("Cookie", account.cookie)
      .expect("Cache-Control", "no-store");
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CloudflareStreamService)
      .useValue(stream)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    database = app.get(DatabaseService);
    operator = await createAccount("video-operator");
    customer = await createAccount("video-customer");
    await app.get(AccessService).bootstrapSuperadmin(operator.id, {
      reason: "Isolated video E2E operator",
    });
    productSlug = `video-test-${randomUUID().slice(0, 8)}`;
    const created = await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({
        slug: productSlug,
        name: "Video test product",
        audience: "unisex",
        variants: [
          {
            sku: `${productSlug}-black-m`,
            color: "Black",
            sizeLabel: "M",
            price: null,
          },
        ],
        reason: "Create isolated video test product",
      })
      .expect(201);
    productId = created.body.id as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("provisions private resumable uploads idempotently and rejects invalid scopes", async () => {
    await managedVideos(customer).expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/manage/${productId}/videos`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({
        commandId: randomUUID(),
        fileSizeBytes: 1200,
        title: "Invalid color video",
        variantColor: "Not a product color",
        reason: "Upload a product clip",
      })
      .expect(400);
    expect((await managedVideos()).body.videos).toEqual([]);

    const commandId = randomUUID();
    const payload = {
      commandId,
      fileSizeBytes: 1200,
      title: "Black tee turntable",
      description: "The fabric and fit from all angles.",
      variantColor: "Black",
      reason: "Add product catalogue video",
    };
    const response = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/manage/${productId}/videos`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send(payload)
      .expect(201);
    videoId = response.body.video.id as string;
    const uploadUrl = response.body.uploadUrl as string;
    providerUid = response.body.video.providerUid ?? "";
    expect(uploadUrl).toMatch(/^https:\/\/upload\.videodelivery\.net\//);
    expect(response.body.video).toMatchObject({
      productId,
      title: payload.title,
      variantColor: "Black",
      status: "awaiting_upload",
    });
    expect(response.body.video).not.toHaveProperty("providerUid");
    expect(response.body.video).not.toHaveProperty("uploadUrlCiphertext");
    expect(providerUid).toBe("");

    const replay = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/manage/${productId}/videos`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send(payload)
      .expect(201);
    expect(replay.body.uploadUrl).toBe(uploadUrl);
    expect(stream.provisionCalls).toBe(1);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/manage/${productId}/videos`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({ ...payload, title: "Different title" })
      .expect(409);

    const [stored] = await database.db
      .select()
      .from(catalogProductVideo)
      .where(eq(catalogProductVideo.id, videoId));
    expect(stored?.uploadUrlCiphertext).not.toContain(
      "upload.videodelivery.net",
    );
    expect(stream.decryptUploadUrl(stored!.uploadUrlCiphertext!, videoId)).toBe(
      uploadUrl,
    );
    expect(stored?.providerUid).toMatch(/^[a-f0-9]{32}$/);
    providerUid = stored!.providerUid!;
    expect((await managedVideos()).body.videos).toHaveLength(1);
  });

  it("moves a completed video through verified webhooks, captions, playback, and retryable deletion", async () => {
    const completed = await request(app.getHttpServer())
      .post(
        `/api/v1/catalog/products/manage/${productId}/videos/${videoId}/complete`,
      )
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .expect(201);
    expect(completed.body.status).toBe("processing");

    const body = JSON.stringify({
      uid: providerUid,
      readyToStream: true,
      status: { state: "ready", pctComplete: "100" },
      duration: 23.5,
    });
    await request(app.getHttpServer())
      .post("/api/v1/catalog/videos/webhook")
      .set("Content-Type", "application/json")
      .set("Webhook-Signature", "test-signature")
      .send(body)
      .expect(204);
    await request(app.getHttpServer())
      .post("/api/v1/catalog/videos/webhook")
      .set("Content-Type", "application/json")
      .set("Webhook-Signature", "test-signature")
      .send(body)
      .expect(204);
    await request(app.getHttpServer())
      .post("/api/v1/catalog/videos/webhook")
      .set("Content-Type", "application/json")
      .set("Webhook-Signature", "invalid")
      .send(body)
      .expect(401);

    const [storedVideo] = await database.db
      .select()
      .from(catalogProductVideo)
      .where(eq(catalogProductVideo.id, videoId));
    expect(storedVideo).toMatchObject({
      status: "ready",
      durationSeconds: "23.500",
      uploadUrlCiphertext: null,
    });
    expect(
      await database.db
        .select({ id: catalogVideoWebhookInbox.id })
        .from(catalogVideoWebhookInbox),
    ).toHaveLength(1);

    const vtt = Buffer.from(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nSoft cotton jersey.\n",
    );
    const caption = await request(app.getHttpServer())
      .post(
        `/api/v1/catalog/products/manage/${productId}/videos/${videoId}/captions/bn`,
      )
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .attach("file", vtt, {
        filename: "captions.vtt",
        contentType: "text/vtt",
      })
      .expect(201);
    expect(caption.body.captions).toEqual([
      { language: "bn", label: "বাংলা", status: "ready" },
    ]);

    await database.db
      .update(catalogProductVariant)
      .set({ priceBdt: 1999 })
      .where(eq(catalogProductVariant.productId, productId));
    await database.db
      .update(catalogProduct)
      .set({ isPublished: true })
      .where(eq(catalogProduct.id, productId));
    const publicFeed = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productSlug}/videos`)
      .expect(200);
    expect(publicFeed.body.videos).toMatchObject([
      {
        id: videoId,
        title: "Black tee turntable",
        playbackUrl: `https://iframe.videodelivery.net/signed-${providerUid}`,
        captions: [{ language: "bn", status: "ready" }],
      },
    ]);

    stream.failNextDelete = true;
    await request(app.getHttpServer())
      .delete(`/api/v1/catalog/products/manage/${productId}/videos/${videoId}`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({ reason: "Remove this product video" })
      .expect(503);
    expect((await managedVideos()).body.videos[0].status).toBe("deleting");

    await request(app.getHttpServer())
      .delete(`/api/v1/catalog/products/manage/${productId}/videos/${videoId}`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({ reason: "Remove this product video" })
      .expect(204);
    expect((await managedVideos()).body.videos).toEqual([]);
    expect(stream.deleted).toEqual([providerUid]);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/catalog/products/${productSlug}/videos`)
          .expect(200)
      ).body.videos,
    ).toEqual([]);

    const events = await database.db
      .select({ eventType: auditEvent.eventType })
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, videoId));
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        "catalog.video_upload_started",
        "catalog.video_upload_url_issued",
        "catalog.video_upload_completed",
        "catalog.video_ready",
        "catalog.video_caption_uploaded",
        "catalog.video_deletion_requested",
        "catalog.video_deleted",
      ]),
    );
  });

  it("expires stale upload URLs and releases their resumable-upload secrets", async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/manage/${productId}/videos`)
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({
        commandId: randomUUID(),
        fileSizeBytes: 1200,
        title: "Expired upload",
        reason: "Exercise stale upload recovery",
      })
      .expect(201);
    const expiredId = response.body.video.id as string;
    const [record] = await database.db
      .select()
      .from(catalogProductVideo)
      .where(eq(catalogProductVideo.id, expiredId));
    expect(record?.uploadUrlCiphertext).toBeTruthy();
    await database.db
      .update(catalogProductVideo)
      .set({ uploadExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(catalogProductVideo.id, expiredId));

    const listed = await managedVideos().expect(200);
    const expired = listed.body.videos.find(
      (video: { id: string }) => video.id === expiredId,
    );
    expect(expired?.status).toBe("error");
    const [stored] = await database.db
      .select()
      .from(catalogProductVideo)
      .where(eq(catalogProductVideo.id, expiredId));
    expect(stored?.uploadUrlCiphertext).toBeNull();
    expect(stored?.uploadExpiresAt).toBeNull();

    await request(app.getHttpServer())
      .delete(
        `/api/v1/catalog/products/manage/${productId}/videos/${expiredId}`,
      )
      .set("Cookie", operator.cookie)
      .set("Origin", origin)
      .send({ reason: "Clean up the expired upload" })
      .expect(204);
  });
});
