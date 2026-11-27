import { test } from "node:test";
import assert from "node:assert/strict";
import { isTierA, TIER_A_COUNTRIES } from "./geo.ts";

test("Tier A list matches the site, the node and the markets", () => {
  assert.deepEqual([...TIER_A_COUNTRIES].sort(), ["AF", "BY", "CN", "CU", "IR", "KP", "MM", "RU", "SY"]);
});

test("only known Tier A countries are blocked", () => {
  for (const c of ["IR", "KP", "cn"]) assert.equal(isTierA(c), true, c);
  for (const c of ["US", "MX", "GB", "DE", "", null, undefined]) assert.equal(isTierA(c), false, String(c));
});
