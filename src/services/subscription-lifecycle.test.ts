import test from "node:test";
import assert from "node:assert/strict";
import { SubscriptionLifecycleService } from "./subscription-lifecycle.service.js";

test("SubscriptionLifecycle: returns active status if subscription endDate is in future", () => {
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const info = SubscriptionLifecycleService.getLifecycleInfo(
    {
      status: "ACTIVE",
      endDate: future,
      gracePeriodEndsAt: null,
      plan: { code: "PRO" },
    },
    5,
  );

  assert.equal(info.status, "ACTIVE");
  assert.equal(info.gracePeriodDaysRemaining, 0);
});

test("SubscriptionLifecycle: enters GRACE_PERIOD when subscription expired but within grace days", () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const info = SubscriptionLifecycleService.getLifecycleInfo(
    {
      status: "ACTIVE",
      endDate: yesterday,
      gracePeriodEndsAt: null,
      plan: { code: "BASIC" },
    },
    5,
  );

  assert.equal(info.status, "GRACE_PERIOD");
  assert.ok(info.gracePeriodDaysRemaining > 0);
  assert.ok(info.gracePeriodEndsAt !== null);
});

test("SubscriptionLifecycle: marks as EXPIRED when grace period is passed", () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const info = SubscriptionLifecycleService.getLifecycleInfo(
    {
      status: "ACTIVE",
      endDate: tenDaysAgo,
      gracePeriodEndsAt: null,
      plan: { code: "PRO" },
    },
    5,
  );

  assert.equal(info.status, "EXPIRED");
  assert.equal(info.gracePeriodDaysRemaining, 0);
});
