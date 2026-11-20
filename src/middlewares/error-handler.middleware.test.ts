import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ErrorHandler } from "./error-handler.middleware.js";
import { BadRequestError, ForbiddenError } from "../utils/errors.js";

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  return {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
    getResult: () => ({ statusCode, body }),
  };
}

const mockReq = { originalUrl: "/api/test", method: "POST" } as any;
const noopNext = () => {};

describe("ErrorHandler", () => {
  it("returns controlled AppError message and code without leaking stack", () => {
    const res = createMockRes();
    ErrorHandler(
      new ForbiddenError("Accès réservé au plan Signature.", "PLAN_REQUIRED"),
      mockReq,
      res as any,
      noopNext,
    );
    const { statusCode, body } = res.getResult();
    assert.equal(statusCode, 403);
    assert.equal(body.message, "Accès réservé au plan Signature.");
    assert.equal(body.code, "PLAN_REQUIRED");
    assert.equal(body.stack, undefined);
  });

  it("maps Prisma P2002 to 409 French message without leaking SQL details", () => {
    const res = createMockRes();
    ErrorHandler(
      { code: "P2002", message: "Unique constraint failed on table `users` (`email`)" },
      mockReq,
      res as any,
      noopNext,
    );
    const { statusCode, body } = res.getResult();
    assert.equal(statusCode, 409);
    assert.equal(body.code, "DUPLICATE_ENTRY");
    assert.ok(!JSON.stringify(body).includes("users"));
  });

  it("maps Multer LIMIT_FILE_SIZE to 400 French message", () => {
    const res = createMockRes();
    ErrorHandler(
      { name: "MulterError", code: "LIMIT_FILE_SIZE", message: "File too large" },
      mockReq,
      res as any,
      noopNext,
    );
    const { statusCode, body } = res.getResult();
    assert.equal(statusCode, 400);
    assert.equal(body.code, "FILE_TOO_LARGE");
  });

  it("never leaks raw unexpected technical error messages and includes errorId", () => {
    const res = createMockRes();
    ErrorHandler(
      new Error("SELECT password FROM users WHERE id = 1 -- ECONNREFUSED 10.0.0.5"),
      mockReq,
      res as any,
      noopNext,
    );
    const { statusCode, body } = res.getResult();
    assert.equal(statusCode, 500);
    assert.match(body.errorId, /^ERR-[A-F0-9]{8}$/);
    assert.ok(!JSON.stringify(body).includes("SELECT"));
    assert.ok(!JSON.stringify(body).includes("10.0.0.5"));
    assert.equal(body.stack, undefined);
  });

  it("returns BadRequestError with code cleanly", () => {
    const res = createMockRes();
    ErrorHandler(
      new BadRequestError("La caisse est fermée.", "CASH_CLOSED"),
      mockReq,
      res as any,
      noopNext,
    );
    const { statusCode, body } = res.getResult();
    assert.equal(statusCode, 400);
    assert.equal(body.code, "CASH_CLOSED");
  });
});
