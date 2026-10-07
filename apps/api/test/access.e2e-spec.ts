import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { AppModule } from "../src/app.module.js";
import { auth } from "../src/auth/auth.js";
import { user } from "../src/auth/auth-schema.js";
import { configureApp } from "../src/configure-app.js";
import { deriveCartCookieSigningSecret } from "../src/cart/cart-cookie.js";
import { AccessService } from "../src/platform/authorization/access.service.js";
import { PermissionsService } from "../src/platform/authorization/permissions.service.js";
import { roleAssignment } from "../src/platform/authorization/access-schema.js";
import { AuditService } from "../src/platform/audit/audit.service.js";
import { auditEvent } from "../src/platform/audit/audit-schema.js";
import { DatabaseService } from "../src/platform/database/database.service.js";
import { RedisService } from "../src/platform/redis/redis.service.js";

type Account = { id: string; email: string; cookie: string };
const origin = "http://localhost:3000";
const password = "aaraj-e2e-password-123";
const reason = { reason: "Test staff onboarding" };

describe("PBAC with real Better Auth sessions and PostgreSQL", () => {
  let app: INestApplication;
  let access: AccessService;
  let database: DatabaseService;
  let owner: Account;
  let secondOwner: Account;
  let admin: Account;
  let staff: Account;
  let moderator: Account;
  let customer: Account;

  async function account(name: string): Promise<Account> {
    const email = `${name}@example.com`;
    const response = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: new Headers({ Origin: origin }),
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      email,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }

  const change = (
    actor: Account,
    target: Account,
    role: string,
    action: "put" | "delete" = "put",
  ) =>
    request(app.getHttpServer())
      [action](`/api/v1/access/users/${target.id}/roles/${role}`)
      .set("Cookie", actor.cookie)
      .set("Origin", origin)
      .send(reason);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({
      bodyParser: false,
      logger: false,
      cookies: { secret: deriveCartCookieSigningSecret() },
    });
    configureApp(app);
    await app.init();
    await app.get(RedisService).checkConnection();
    access = app.get(AccessService);
    database = app.get(DatabaseService);
    owner = await account("owner");
    secondOwner = await account("second-owner");
    admin = await account("admin");
    staff = await account("staff");
    moderator = await account("moderator");
    customer = await account("customer");
  });

  afterAll(async () => {
    await app?.close();
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts every account as a customer and protects access routes from guests", async () => {
    await request(app.getHttpServer()).get("/api/v1/access/me").expect(401);
    await request(app.getHttpServer()).get("/api/v1/access/roles").expect(401);
    await request(app.getHttpServer())
      .put(`/api/v1/access/users/${customer.id}/roles/admin`)
      .set("Origin", origin)
      .send(reason)
      .expect(401);
    const response = await request(app.getHttpServer())
      .get("/api/v1/access/me")
      .set("Cookie", owner.cookie)
      .expect(200);
    expect(response.body).toEqual({
      userId: owner.id,
      roles: ["customer"],
      permissions: ["access.read_self"],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("bootstraps exactly one initial superadmin even under concurrent attempts", async () => {
    const results = await Promise.allSettled([
      access.bootstrapSuperadmin(owner.id, reason),
      access.bootstrapSuperadmin(secondOwner.id, reason),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    if (results[1]!.status === "fulfilled")
      [owner, secondOwner] = [secondOwner, owner];
    await expect(
      access.bootstrapSuperadmin(customer.id, reason),
    ).rejects.toThrow("already exists");
    const events = await database.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.eventType, "access.superadmin_bootstrapped"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorType: "service",
      subjectId: owner.id,
    });
  });

  it("passes an HTTP email sign-in through the Better Auth guard and a Nest policy", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("Origin", origin)
      .send({ email: owner.email, password })
      .expect(200);
    const cookies = login.headers["set-cookie"] as unknown as string[];
    owner.cookie = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    await request(app.getHttpServer())
      .get("/api/v1/access/roles")
      .set("Cookie", owner.cookie)
      .expect(200);
  });

  it("assigns explicit role bundles without giving admins permission to manage roles", async () => {
    const grants = await Promise.all([
      change(owner, admin, "admin"),
      change(owner, admin, "admin"),
    ]);
    expect(grants.map((result) => result.status)).toEqual([200, 200]);
    await change(owner, staff, "staff").expect(200);
    await change(owner, moderator, "moderator").expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/access/roles")
      .set("Cookie", admin.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/access/users/${staff.id}`)
      .set("Cookie", admin.cookie)
      .expect(200);
    for (const actor of [admin, staff, moderator, customer]) {
      await change(actor, customer, "superadmin").expect(403);
    }
    for (const actor of [staff, moderator, customer]) {
      await request(app.getHttpServer())
        .get("/api/v1/access/roles")
        .set("Cookie", actor.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/access/users/${owner.id}`)
        .set("Cookie", actor.cookie)
        .expect(403);
    }
    await expect(
      access.changeRole(customer, customer.id, "superadmin", "grant", reason),
    ).rejects.toThrow("Forbidden");
  });

  it("does not trust a client-selected user or role and validates mutation inputs", async () => {
    const self = await request(app.getHttpServer())
      .get(`/api/v1/access/me?userId=${owner.id}&role=superadmin`)
      .set("Cookie", customer.cookie)
      .set("X-Role", "superadmin")
      .expect(200);
    expect(self.body.userId).toBe(customer.id);
    expect(self.body.roles).toEqual(["customer"]);
    for (const role of ["customer", "owner", "*"])
      await change(owner, customer, role).expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/access/users/${customer.id}/roles/admin`)
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .send({ reason: "ok", role: "superadmin" })
      .expect(400);
    await change(owner, owner, "admin").expect(403);
    await change(owner, { ...customer, id: "missing-user" }, "staff").expect(
      404,
    );
  });

  it("ignores attempted privileged roles in public registration", async () => {
    const registration = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("Origin", origin)
      .send({
        name: "Public signup",
        email: "public-signup@example.com",
        password,
        role: "superadmin",
        roles: ["superadmin"],
        permissions: ["access.manage"],
      })
      .expect(200);
    const cookies = registration.headers["set-cookie"] as unknown as string[];
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    const response = await request(app.getHttpServer())
      .get("/api/v1/access/me")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body.roles).toEqual(["customer"]);
    expect(response.body.permissions).toEqual(["access.read_self"]);
  });

  it("prevents account deletion from silently removing elevated assignments", async () => {
    await expect(
      database.db.delete(user).where(eq(user.id, owner.id)),
    ).rejects.toThrow();
    expect(
      (await app.get(PermissionsService).forUser(owner.id))?.roles,
    ).toContain("superadmin");
  });

  it("requires trusted Origin on cookie-authenticated role writes", async () => {
    for (const invalidOrigin of [
      undefined,
      "https://attacker.example",
      "null",
    ]) {
      const operation = request(app.getHttpServer())
        .put(`/api/v1/access/users/${customer.id}/roles/staff`)
        .set("Cookie", owner.cookie);
      if (invalidOrigin) operation.set("Origin", invalidOrigin);
      await operation.send(reason).expect(403);
    }
  });

  it("makes retries idempotent and revocation effective with the same session", async () => {
    await change(owner, admin, "admin").expect(200);
    let grants = await database.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.subjectId, admin.id),
          eq(auditEvent.eventType, "access.role_granted"),
        ),
      );
    expect(grants).toHaveLength(1);
    await change(owner, admin, "admin", "delete").expect(200);
    await change(owner, admin, "admin", "delete").expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/access/roles")
      .set("Cookie", admin.cookie)
      .expect(403);
    grants = await database.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.subjectId, admin.id),
          eq(auditEvent.eventType, "access.role_revoked"),
        ),
      );
    expect(grants).toHaveLength(1);
  });

  it("requires a recent sign-in for role changes while leaving read access available", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60 * 1000);
    const response = await change(owner, customer, "staff").expect(403);
    expect(response.body.errorCode).toBe("RECENT_SIGN_IN_REQUIRED");
    await request(app.getHttpServer())
      .get("/api/v1/access/roles")
      .set("Cookie", owner.cookie)
      .expect(200);
  });

  it("rolls back role changes if the audit insert fails", async () => {
    vi.spyOn(app.get(AuditService), "append").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    await change(owner, customer, "staff").expect(500);
    const result = await app.get(PermissionsService).forUser(customer.id);
    expect(result?.roles).toEqual(["customer"]);
    vi.spyOn(app.get(AuditService), "append").mockRejectedValueOnce(
      new Error("Audit unavailable"),
    );
    await change(owner, staff, "staff", "delete").expect(500);
    expect(
      (await app.get(PermissionsService).forUser(staff.id))?.roles,
    ).toContain("staff");
  });

  it("protects the last superadmin under concurrent self-revocation", async () => {
    await change(owner, secondOwner, "superadmin").expect(200);
    const results = await Promise.all([
      change(owner, owner, "superadmin", "delete"),
      change(secondOwner, secondOwner, "superadmin", "delete"),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    const remaining = await database.db
      .select()
      .from(roleAssignment)
      .where(eq(roleAssignment.role, "superadmin"));
    expect(remaining).toHaveLength(1);
    const currentOwner =
      remaining[0]!.userId === owner.id ? owner : secondOwner;
    const revokedOwner = currentOwner.id === owner.id ? secondOwner : owner;
    await change(revokedOwner, customer, "admin").expect(403);
    await change(currentOwner, currentOwner, "superadmin", "delete").expect(
      409,
    );
  });

  it("rejects a signed-out session on a protected route", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/sign-out")
      .set("Origin", origin)
      .set("Cookie", customer.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/access/me")
      .set("Cookie", customer.cookie)
      .expect(401);
  });
});
