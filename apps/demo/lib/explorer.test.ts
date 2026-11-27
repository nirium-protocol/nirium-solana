// Offline tests for the explorer logic. The chain answers are the recorded public devnet RPC
// answers for one of the team's self-test receipts (solana/fixtures/devnet-sdk-selftest-rpc.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, verifyReceipt, isChainCheck } from "./receipt.ts";
import { readTransaction, formatUnits, cleanRpcUrl, rpcFailureOf, DEVNET, MAINNET } from "./chain.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const recorded = read("../../../solana/fixtures/devnet-sdk-selftest-rpc.json");
const receipt = read("../../../evidence/2026-11-26/solana-devnet-sdk-binding.json");
const mainnetReceipt = read("../../../evidence/2026-11-26/solana-mainnet-binding.json");

async function withRecordedRpc<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const result = method === "getGenesisHash" ? recorded.genesis
      : method === "getTransaction" && params[0] === recorded.tx.transaction.signatures[0] ? recorded.tx : null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("classify: the network comes from the receipt, and bad input is named", () => {
  const r = classify(JSON.stringify(receipt));
  assert.equal(r.kind, "receipt");
  assert.equal(r.kind === "receipt" ? r.network : null, DEVNET);
  const m = classify(JSON.stringify(mainnetReceipt));
  assert.equal(m.kind === "receipt" ? m.network : null, MAINNET);
  assert.deepEqual(classify(`  ${receipt.record.payment.tx}\n`), { kind: "signature", signature: receipt.record.payment.tx });
  assert.deepEqual(classify("{ not json"), { kind: "invalid", reason: "not-json" });
  assert.deepEqual(classify('{"a":1}'), { kind: "invalid", reason: "not-a-receipt" });
  assert.deepEqual(classify('{"record":{"payment":{"network":"eip155:43113"}}}'), { kind: "invalid", reason: "unknown-network" });
  assert.deepEqual(classify("0x1234"), { kind: "invalid", reason: "unrecognized" });
});

test("a real devnet receipt is VALID with the shared verifier, checks split receipt / chain", async () => {
  const v = await withRecordedRpc(() => verifyReceipt(receipt, DEVNET, null));
  assert.equal(v.status, "valid");
  if (v.status !== "valid") return;
  assert.equal(v.checks.length, 27);
  assert.ok(v.checks.some((c) => isChainCheck(c.name)) && v.checks.some((c) => !isChainCheck(c.name)));
  assert.equal(isChainCheck("content_sha256 == sha256(canonical(record))"), false);
  assert.equal(isChainCheck("Memo text == x402.nonce"), true);
});

test("an altered amount is INVALID, not a transport problem", async () => {
  const d = structuredClone(receipt);
  d.record.payment.amount = "10001";
  const v = await withRecordedRpc(() => verifyReceipt(d, DEVNET, null));
  assert.equal(v.status, "invalid");
});

test("mainnet without the visitor's RPC asks for one and makes no request", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("no request expected"); }) as typeof fetch;
  try { assert.deepEqual(await verifyReceipt(mainnetReceipt, MAINNET, null), { status: "needs-rpc" }); }
  finally { globalThis.fetch = real; }
});

test("an RPC that refuses browsers is reported as blocked, not as an invalid receipt", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"jsonrpc":"2.0","error":{"code":403,"message":"Access forbidden"},"id":1}', { status: 403 })) as typeof fetch;
  try { assert.deepEqual(await verifyReceipt(mainnetReceipt, MAINNET, "https://rpc.example"), { status: "rpc-error", failure: "blocked" }); }
  finally { globalThis.fetch = real; }
});

test("what the chain alone shows: one USDC transfer, the payer, the payTo and the Memo", () => {
  const v = readTransaction(recorded.tx, DEVNET, recorded.tx.transaction.signatures[0]);
  assert.equal(v.failed, false);
  assert.deepEqual(v.memos, [receipt.record.payment.x402.nonce]);
  assert.equal(v.transfers.length, 1);
  const [x] = v.transfers;
  assert.equal(x.index, "2");
  assert.equal(x.from, receipt.record.payment.from);
  assert.equal(x.to, receipt.record.payment.to);
  assert.equal(x.amount, "10000");
  assert.equal(x.usdc, true);
  assert.equal(formatUnits(x.amount, x.decimals), "0.01");
});

test("helpers: units, RPC URLs and transport errors", () => {
  assert.equal(formatUnits("1", 6), "0.000001");
  assert.equal(formatUnits("1500000", 6), "1.5");
  assert.equal(formatUnits("7", null), "7");
  assert.equal(cleanRpcUrl("https://rpc.example/x"), "https://rpc.example/x");
  assert.equal(cleanRpcUrl("http://localhost:8899"), "http://localhost:8899/");
  assert.equal(cleanRpcUrl("http://rpc.example"), null);
  assert.equal(cleanRpcUrl("javascript:alert(1)"), null);
  assert.equal(rpcFailureOf(new Error("getGenesisHash: RPC error HTTP 429 (transport, not a verdict on the binding)")), "rate-limited");
  assert.equal(rpcFailureOf(new Error("missing record.payment")), null);
});
