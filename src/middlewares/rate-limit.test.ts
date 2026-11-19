import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rate-limit.middleware.js";

test("RateLimiter allows requests within the limit", () => {
  const limiter = createRateLimiter({
    windowMs: 1000,
    max: 2,
    message: "Trop de requêtes",
  });
  const req = { ip: "127.0.0.1", method: "POST", headers: {}, socket: {} } as any;
  const headers: Record<string, any> = {};
  const res = {
    setHeader: (name: string, val: any) => {
      headers[name] = val;
    },
    status: () => res,
    json: () => res,
  } as any;

  let called = false;
  const next = () => {
    called = true;
  };

  // 1ère requête
  called = false;
  limiter(req, res, next);
  assert.equal(called, true);
  assert.equal(headers["RateLimit-Remaining"], "1");

  // 2ème requête
  called = false;
  limiter(req, res, next);
  assert.equal(called, true);
  assert.equal(headers["RateLimit-Remaining"], "0");

  // 3ème requête -> Bloquée (429)
  called = false;
  let statusSent = 0;
  let bodySent: any = null;
  res.status = (code: number) => {
    statusSent = code;
    return res;
  };
  res.json = (body: any) => {
    bodySent = body;
    return res;
  };

  limiter(req, res, next);
  assert.equal(called, false);
  assert.equal(statusSent, 429);
  assert.equal(bodySent.message, "Trop de requêtes");
  assert.ok(Number(headers["Retry-After"]) >= 1);
});
