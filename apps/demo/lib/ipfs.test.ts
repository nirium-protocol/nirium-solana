// Offline tests for the CID path: detection of what was pasted, the gateway chain (recorded
// answers, no network), and the CID recomputed from the bytes. The bytes anchored on IPFS for each
// team receipt are the compact JSON of its file in evidence/, so these tests use those files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCid, cidMatches, fetchCid, base32, GATEWAYS } from "./ipfs.ts";
import { classify } from "./receipt.ts";

const anchored = (p: string) => new TextEncoder().encode(JSON.stringify(JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"))));
const devnet = anchored("../../../evidence/2026-11-26/solana-devnet-binding.json");
const DEVNET_CID = "QmWMvQ8pcAGs2fojuZvUzxj68VvZfdYYpbR8gqL6j9cCi6";
const mainnet = anchored("../../../evidence/2026-11-26/solana-mainnet-binding.json");
const MAINNET_CID = "Qme4Cwz5suiYQ5bRKjQqvxFdtRWwDQSbE5m2ZxLNq8Vuhg";
const SIG = "2uyixpix6haUfxhzRfMNtRcZ8fDHGJ1dNLHSZQ5dL6qXK3B6KfTpFpvSpgwXhpqjQ5AmD2xT2KuMt7p8m9g5UfE8";

test("detects what was pasted: CID, gateway URL, signature, receipt, other networks", () => {
  for (const s of [DEVNET_CID, `ipfs://${DEVNET_CID}`, `https://gateway.pinata.cloud/ipfs/${DEVNET_CID}`, `https://${DEVNET_CID}.ipfs.dweb.link/`, ` ${DEVNET_CID}\n`]) {
    assert.deepEqual(classify(s), { kind: "cid", cid: DEVNET_CID }, s);
  }
  assert.equal(classify(SIG).kind, "signature");
  assert.equal(classify(new TextDecoder().decode(devnet)).kind, "receipt");
  assert.deepEqual(classify(`0x${"ab".repeat(32)}`), { kind: "foreign", family: "evm" });
  assert.deepEqual(classify('{"version":"1.1.0","content_sha256":"x","network":"stellar:pubnet"}'), { kind: "foreign", family: "stellar" });
  assert.deepEqual(classify('{"record":{"payment":{"network":"eip155:43113"}}}'), { kind: "foreign", family: "evm" });
  assert.equal(extractCid("Qm123"), null);
  assert.equal(classify("hello").kind, "invalid");
});

test("the CID recomputed from the anchored bytes is the CID (v0 and v1)", async () => {
  assert.equal(await cidMatches(DEVNET_CID, devnet), true);
  assert.equal(await cidMatches(MAINNET_CID, mainnet), true);
  assert.equal(await cidMatches(DEVNET_CID, mainnet), false);
  // The same block as CIDv1 (dag-pb, base32): same multihash, different spelling.
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of DEVNET_CID) n = n * 58n + BigInt(B58.indexOf(c));
  const mh = Uint8Array.from(n.toString(16).padStart(68, "0").match(/../g)!.map((h) => parseInt(h, 16)));
  const v1 = "b" + base32(Uint8Array.of(0x01, 0x70, ...mh));
  assert.equal(extractCid(v1), v1);
  assert.equal(await cidMatches(v1, devnet), true);
  assert.equal(await cidMatches(v1, mainnet), false);
});

// A fetch that answers per gateway from a recorded table, and remembers what was asked.
function recorded(answers: Record<string, () => Response>) {
  const asked: string[] = [];
  const impl = (async (url: string) => {
    asked.push(url);
    const gw = GATEWAYS.find((g) => url.startsWith(g))!;
    return answers[gw] ? answers[gw]() : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

test("a 429 or a failing gateway moves on to the next one, in order", async () => {
  const { impl, asked } = recorded({
    [GATEWAYS[0]]: () => new Response("slow down", { status: 429 }),
    [GATEWAYS[1]]: () => { throw new TypeError("Failed to fetch"); },
    [GATEWAYS[2]]: () => new Response(devnet, { status: 200 }),
  });
  const got = await fetchCid(DEVNET_CID, { fetchImpl: impl });
  assert.equal(got.status, "ok");
  if (got.status !== "ok") return;
  assert.equal(got.gateway, GATEWAYS[2]);
  assert.equal(got.cidCheck, true);
  assert.deepEqual(got.attempts.map((a) => a.status), [429, "error", 200]);
  assert.deepEqual(asked, GATEWAYS.slice(0, 3).map((g) => `${g}/ipfs/${DEVNET_CID}`));
});

test("a gateway that serves other bytes is a FAIL that names it, not a receipt", async () => {
  const { impl } = recorded({ [GATEWAYS[0]]: () => new Response(mainnet, { status: 200 }) });
  const got = await fetchCid(DEVNET_CID, { fetchImpl: impl });
  assert.deepEqual(got, { status: "mismatch", gateway: GATEWAYS[0], attempts: [{ gateway: GATEWAYS[0], status: 200 }] });
});

test("no gateway has it: not-found, with every attempt listed", async () => {
  const { impl } = recorded({});
  const got = await fetchCid(DEVNET_CID, { fetchImpl: impl });
  assert.equal(got.status, "not-found");
  assert.equal(got.attempts.length, GATEWAYS.length);
});
