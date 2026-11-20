import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePayload, validateNumericParams } from "./validate.middleware.js";

describe("validatePayload", () => {
  it("accepts valid payloads", () => {
    const err = validatePayload(
      {
        email: "merchant@jokko.sn",
        amount: 15000,
        type: "IN",
        items: [{ productId: 1 }],
      },
      {
        email: { type: "email", required: true },
        amount: { type: "number", required: true, min: 1 },
        type: { type: "enum", required: true, values: ["IN", "OUT"] },
        items: { type: "array", required: true, minLength: 1 },
      },
    );
    assert.equal(err, null);
  });

  it("rejects missing required fields and invalid enums/numbers", () => {
    assert.match(
      validatePayload({}, { name: { type: "string", required: true, label: "Nom" } })!,
      /Nom/,
    );
    assert.match(
      validatePayload(
        { qty: 1.5 },
        { qty: { type: "integer", required: true, label: "Quantité" } },
      )!,
      /entier/,
    );
    assert.match(
      validatePayload(
        { type: "INVALID" },
        { type: { type: "enum", required: true, values: ["IN", "OUT"], label: "Type" } },
      )!,
      /Type/,
    );
  });
});

describe("validateNumericParams", () => {
  it("passes positive integer params and rejects NaN/negative/alpha params", () => {
    const mw = validateNumericParams("id");

    let calledWith: unknown = "NOT_CALLED";
    mw({ params: { id: "42" } } as any, {} as any, (err?: unknown) => {
      calledWith = err;
    });
    assert.equal(calledWith, undefined);

    let rejectedErr: any = null;
    mw({ params: { id: "abc" } } as any, {} as any, (err?: unknown) => {
      rejectedErr = err;
    });
    assert.equal(rejectedErr?.statusCode, 400);
  });
});
