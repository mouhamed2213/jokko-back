import { after, before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { createApp } from "./app.js";
import { env } from "./config/env-config.js";
import { prisma } from "./config/prisma.js";
import { MaintenanceService } from "./modules/maintenance/maintenance.service.js";
import { SubscriptionService } from "./modules/subscriptions/subscription.service.js";

let server: Server;
let baseUrl = "";

function makeToken(role: "ADMIN" | "EMPLOYEE", userId = 1, ownerId = 1, shopId = 10) {
  return jwt.sign(
    {
      ownerId,
      userId,
      shopId,
      planType: "PRO",
      role,
      email: role === "ADMIN" ? "admin@jokko.sn" : "employee@jokko.sn",
    },
    env.secret.jwt,
    { expiresIn: "1h" },
  );
}

describe("HTTP Integration Tests (Express pipeline)", () => {
  before(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  const originalShopDelegate = prisma.shop;
  const originalUserDelegate = prisma.user;
  const originalShopOwnerDelegate = prisma.shopOwner;

  after(async () => {
    mock.restoreAll();
    Object.defineProperty(prisma, "shop", {
      value: originalShopDelegate,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prisma, "user", {
      value: originalUserDelegate,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prisma, "shopOwner", {
      value: originalShopOwnerDelegate,
      configurable: true,
      writable: true,
    });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    mock.restoreAll();
    mock.method(MaintenanceService, "getStatus", async () => ({
      enabled: false,
      message: "",
    }));
    Object.defineProperty(prisma, "shop", {
      value: {
        findUnique: async () => ({
          id: 10,
          status: "ACTIVE",
          primaryShopId: null,
          primaryShop: null,
        }),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prisma, "shopOwner", {
      value: {
        findFirst: async () => ({ id: 1, userId: 1, shopId: 10 }),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prisma, "user", {
      value: {
        findUnique: async (args: any) => {
          const id = args?.where?.id;
          if (id === 2) {
            return {
              id: 2,
              shopId: 10,
              email: "employee@jokko.sn",
              role: "EMPLOYEE",
              isActive: true,
            };
          }
          return {
            id: 1,
            shopId: 10,
            email: "admin@jokko.sn",
            role: "ADMIN",
            isActive: true,
          };
        },
      },
      configurable: true,
      writable: true,
    });
  });

  it("GET / returns 200 healthcheck", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.status, "running");
  });

  it("GET /api/unknown-route returns 404 JSON", async () => {
    const res = await fetch(`${baseUrl}/api/unknown-route`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as any;
    assert.match(body.message, /Route non trouvée/);
  });

  it("POST /api/sales with malformed JSON returns 400 INVALID_JSON without stack leak", async () => {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json",
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.equal(body.code, "INVALID_JSON");
    assert.equal(body.stack, undefined);
  });

  it("POST /api/sales without token returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 401);
  });

  it("GET /api/sales returns 503 when maintenance mode is enabled", async () => {
    mock.restoreAll();
    mock.method(MaintenanceService, "getStatus", async () => ({
      enabled: true,
      message: "Maintenance en cours",
    }));

    const res = await fetch(`${baseUrl}/api/sales`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as any;
    assert.equal(body.code, "MAINTENANCE_MODE");
  });

  it("blocks EMPLOYEE from GET /api/analytics/profit with 403", async () => {
    const token = makeToken("EMPLOYEE", 2, 1, 10);
    const res = await fetch(`${baseUrl}/api/analytics/profit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
  });

  it("blocks EMPLOYEE from GET /api/analytics/overview/multi-store with 403", async () => {
    const token = makeToken("EMPLOYEE", 2, 1, 10);
    const res = await fetch(`${baseUrl}/api/analytics/overview/multi-store`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
  });

  it("blocks PRO plan ADMIN from GET /api/analytics/profit with 403 requiring Signature", async () => {
    mock.method(SubscriptionService, "currentSubscription", async () => ({
      plan: { code: "PRO", name: "Pro" },
      features: ["ADVANCED_REPORTS"],
      limits: {},
    }) as any);

    const token = makeToken("ADMIN", 1, 1, 10);
    const res = await fetch(`${baseUrl}/api/analytics/profit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as any;
    assert.match(body.message, /Signature/);
  });

  it("rejects non-numeric :id param on GET /api/sales/abc with 400", async () => {
    const token = makeToken("ADMIN", 1, 1, 10);
    const res = await fetch(`${baseUrl}/api/sales/abc`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.match(body.message, /Identifiant invalide/);
  });

  it("rejects invalid cash transaction type with 400", async () => {
    const token = makeToken("ADMIN", 1, 1, 10);
    const res = await fetch(`${baseUrl}/api/cash/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "INVALID", amount: 5000, label: "Test" }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects POST /api/sales with empty items array with 400", async () => {
    const token = makeToken("ADMIN", 1, 1, 10);
    const res = await fetch(`${baseUrl}/api/sales`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as any;
    assert.match(body.message, /Articles/);
  });
});
