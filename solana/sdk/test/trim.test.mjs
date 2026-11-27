import { test } from "node:test";
import assert from "node:assert/strict";
import { trimTrailingSlashes } from "../serve.mjs";

test("trimTrailingSlashes removes only trailing slashes, in linear time", () => {
  assert.equal(trimTrailingSlashes("https://facilitator.payai.network"), "https://facilitator.payai.network");
  assert.equal(trimTrailingSlashes("https://facilitator.payai.network/"), "https://facilitator.payai.network");
  assert.equal(trimTrailingSlashes("https://x.example/a///"), "https://x.example/a");
  assert.equal(trimTrailingSlashes("///"), "");
  assert.equal(trimTrailingSlashes(""), "");
  const evil = "/".repeat(200_000) + "x";
  const t0 = Date.now();
  assert.equal(trimTrailingSlashes(evil), evil);
  assert.equal(trimTrailingSlashes("a" + "/".repeat(200_000)), "a");
  assert.ok(Date.now() - t0 < 200, "should be linear");
});
