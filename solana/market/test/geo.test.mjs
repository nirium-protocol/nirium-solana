// Tier A is closed on the market, with the real geoip-lite data and the real app (X-Forwarded-For plays
// the trusted proxy hop, as on Fly). Tier B and allowed countries are never geo-blocked; /health stays open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createMarketApp } from "../server.mjs";
import { TIER_A_COUNTRIES } from "../geo.mjs";

const IRAN = "5.160.0.1", NORTH_KOREA = "175.45.176.1", CHINA = "180.76.76.76", US = "8.8.8.8", MEXICO = "187.191.37.227";

async function start() {
  const app = createMarketApp({ payTo: "4xdH6PvKDqntiHqFea5x6XQpJ4wtgrK5qS42nu7KQZt", read: async () => ({ ok: true }) });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const get = (base, path, ip) => fetch(base + path, { headers: { "X-Forwarded-For": ip } });

test("Tier A list matches the Nirium node", () => {
  assert.deepEqual([...TIER_A_COUNTRIES].sort(), ["AF", "BY", "CN", "CU", "IR", "KP", "MM", "RU", "SY"]);
});

test("Tier A gets 451 on every market route, including the paid one", async () => {
  const { base, close } = await start();
  try {
    for (const ip of [IRAN, NORTH_KOREA, CHINA]) {
      for (const path of ["/", "/v1/market/info", "/v1/market"]) {
        const res = await get(base, path, ip);
        assert.equal(res.status, 451, `${path} from ${ip}`);
        assert.equal((await res.json()).error, "unavailable_for_legal_reasons");
      }
    }
  } finally { close(); }
});

test("the US (Tier B) and Mexico are not geo-blocked; /health stays open from Tier A", async () => {
  const { base, close } = await start();
  try {
    for (const ip of [US, MEXICO]) {
      assert.equal((await get(base, "/v1/market/info", ip)).status, 200, ip);
      assert.equal((await get(base, "/", ip)).status, 200, ip);
    }
    assert.equal((await get(base, "/health", IRAN)).status, 200);
  } finally { close(); }
});
