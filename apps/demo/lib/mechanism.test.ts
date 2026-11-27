// Offline tests for the drawing: each link is decided by the verifier's checks, and each edit breaks
// the links it should and only those. Chain answers are the recorded public devnet RPC answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyReceipt } from "./receipt.ts";
import { readTransaction, DEVNET } from "./chain.ts";
import { links, edit, cachingFetch, withFetch, type Edit } from "./mechanism.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../../../solana/fixtures/devnet-sdk-selftest-rpc.json");
const receipt = read("../../../evidence/2026-11-26/solana-devnet-sdk-binding.json");
const tx = readTransaction(recorded.tx, DEVNET, recorded.tx.transaction.signatures[0]);

let calls = 0;
const rpc = (async (_url: string, init: RequestInit) => {
  calls++;
  const { method, params } = JSON.parse(String(init.body));
  const result = method === "getGenesisHash" ? recorded.genesis
    : method === "getTransaction" && params[0] === recorded.tx.transaction.signatures[0] ? recorded.tx : null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

async function check(doc: any, f: typeof fetch) {
  const v = await withFetch(f, () => verifyReceipt(doc, DEVNET, null));
  assert.ok(v.status === "valid" || v.status === "invalid", v.status);
  return { status: v.status, links: links(doc, tx, "checks" in v ? v.checks : []) };
}
const broken = (ls: ReturnType<typeof links>) => ls.filter((l) => !l.ok).map((l) => l.key).sort();

test("a real receipt: every link passes, and both sides show the same values", async () => {
  const { status, links: ls } = await check(receipt, rpc);
  assert.equal(status, "valid");
  assert.deepEqual(broken(ls), []);
  const by = Object.fromEntries(ls.map((l) => [l.key, l]));
  assert.equal(by.amount.receipt, "0.01 USDC");
  assert.equal(by.amount.chain, "0.01 USDC");
  assert.equal(by.reference.chain, receipt.record.payment.x402.nonce);
});

test("each edit breaks exactly the links it should, with the verifier re-run from cache", async () => {
  const f = cachingFetch(rpc);
  await check(receipt, f);
  const before = calls;
  const expected: Record<Edit, string[]> = {
    amount: ["amount", "content"],        // the chain moved another amount, and the signature no longer covers it
    destination: ["content", "destination"],
    purpose: ["content"],                 // the chain never had the purpose: only the signature protects it
  };
  for (const [what, keys] of Object.entries(expected)) {
    const { status, links: ls } = await check(edit(receipt, what as Edit), f);
    assert.equal(status, "invalid", what);
    assert.deepEqual(broken(ls), keys, what);
  }
  assert.equal(calls, before, "edits must not ask the RPC again");
});
