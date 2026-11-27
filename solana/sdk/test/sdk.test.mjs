// Tests for nirium-solana. The pay/charge loop runs offline: a fake RPC answers the mint, the
// payTo's USDC token account and the blockhash; a fake facilitator decodes the transaction it
// receives, checks the payer's ed25519 signature and checks the transfer and memo with the same
// decoder the policy gate uses. The receipt test rebuilds one of the team's real devnet receipts
// over the public devnet RPC.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { verify as edVerify, createPublicKey } from "node:crypto";
import express from "express";
import { generateKeyPairSigner, getTransactionDecoder, getBase64Encoder, getAddressEncoder } from "@solana/kit";
import { describeAuthorization, associatedTokenAddress } from "nirium-solana-policy";
import {
  x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, dollarsToAtomic,
  createRulesPolicy, X402PolicyError, DEVNET,
} from "../index.mjs";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
let payer, payTo, payToAta, feePayer, blockhash, rpc, rpcUrl;
const state = { ataExists: true };

async function listen(s) { await new Promise((r) => s.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${s.address().port}`; }
const accountReply = (data, owner) => ({ context: { slot: 1 }, value: { data: [data.toString("base64"), "base64"], executable: false, lamports: 2039280, owner, rentEpoch: 0, space: data.length } });

before(async () => {
  payer = await generateKeyPairSigner();
  payTo = (await generateKeyPairSigner()).address;
  feePayer = (await generateKeyPairSigner()).address;
  blockhash = (await generateKeyPairSigner()).address;
  payToAta = String(await associatedTokenAddress(payTo, USDC, TOKEN));
  rpc = createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => {
      const m = JSON.parse(b);
      let result = null;
      if (m.method === "getAccountInfo") {
        const addr = m.params[0];
        if (addr === USDC) { const d = Buffer.alloc(82); d[44] = 6; d[45] = 1; result = accountReply(d, TOKEN); }
        else if (addr === payToAta) result = state.ataExists ? accountReply(Buffer.alloc(165), TOKEN) : { context: { slot: 1 }, value: null };
        else result = { context: { slot: 1 }, value: null };
      } else if (m.method === "getLatestBlockhash") result = { context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 100 } };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...(result ? { result } : { error: { code: -32601, message: `fake RPC: ${m.method}` } }) }));
    });
  });
  rpcUrl = await listen(rpc);
});
after(() => rpc.close());

/** Fake facilitator: decodes the tx, checks the payer's signature and the exact transfer + memo. */
async function fakeFacilitator() {
  const calls = { verify: 0, settle: 0, bad: 0, memo: undefined };
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url.endsWith("/supported")) return send({ kinds: [{ x402Version: 2, scheme: "exact", network: DEVNET, extra: { feePayer, transactionVersions: [0, 1] } }], extensions: [], signers: { "solana:*": [feePayer] } });
      const { paymentPayload: p, paymentRequirements: r } = JSON.parse(body);
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(p.payload.transaction));
      const sig = tx.signatures[payer.address];
      const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(getAddressEncoder().encode(payer.address))]);
      let ok = !!sig && edVerify(null, Buffer.from(tx.messageBytes), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(sig));
      try { const a = await describeAuthorization(new Uint8Array(tx.messageBytes), r, payer.address); calls.memo = a.memo; } catch { ok = false; }
      if (!ok) calls.bad++;
      if (req.url.endsWith("/verify")) { calls.verify++; return send({ isValid: ok, payer: payer.address, ...(ok ? {} : { invalidReason: "bad" }) }); }
      calls.settle++;
      return send(ok ? { success: true, transaction: "5".repeat(87), network: DEVNET, payer: payer.address } : { success: false, errorReason: "bad", transaction: "", network: DEVNET });
    });
  });
  return { url: await listen(server), calls, close: () => server.close() };
}

async function seller(facilitatorUrl) {
  const app = express();
  app.use(x402Serve({ payTo, network: DEVNET, facilitatorUrl, rpcUrl, routes: { "GET /paid": "$0.01" } }));
  app.get("/paid", (req, res) => res.json({ ok: true }));
  app.get("/health", (req, res) => res.json({ up: true }));
  const server = createServer(app);
  return { url: await listen(server), close: () => server.close() };
}

test("dollarsToAtomic converts exactly and rejects bad prices", () => {
  assert.equal(dollarsToAtomic("$0.01"), "10000");
  for (const bad of ["$0", "0.0000001", "x"]) assert.throws(() => dollarsToAtomic(bad));
});

test("x402Serve refuses a bad config at mount; createX402Fetch refuses mainnet without allowMainnet", async () => {
  assert.throws(() => x402Serve({ payTo: "not-an-address", routes: { "/a": "$1" } }), /payTo/);
  assert.throws(() => x402Serve({ payTo, routes: {} }), /routes/);
  assert.throws(() => createX402Fetch({ signer: payer, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", maxAmountPerPayment: "10000" }), /mainnet/);
});

test("pay and charge end to end: the order ref becomes the memo, and the facilitator verifies the payer's signature", async () => {
  const fac = await fakeFacilitator();
  const s = await seller(fac.url);
  try {
    assert.equal((await fetch(`${s.url}/paid`)).status, 402);
    const pay = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "10000", rpcUrl });
    const res = await pay(`${s.url}/paid`, { headers: { "X-Nirium-Ref": "order-42" } });
    assert.equal(res.status, 200);
    assert.equal(fac.calls.verify, 1);
    assert.equal(fac.calls.settle, 1);
    assert.equal(fac.calls.bad, 0);
    assert.equal(fac.calls.memo, "order-42");
    assert.equal(settlementOf(res).transaction, "5".repeat(87));
  } finally { s.close(); fac.close(); }
});

test("a malformed order ref is refused with 400 before any payment", async () => {
  const fac = await fakeFacilitator();
  const s = await seller(fac.url);
  try {
    const r = await fetch(`${s.url}/paid`, { headers: { "X-Nirium-Ref": "bad ref with spaces" } });
    assert.equal(r.status, 400);
    assert.equal(fac.calls.verify + fac.calls.settle, 0);
  } finally { s.close(); fac.close(); }
});

test("the per-payment cap and a policy DENY send nothing; a policy ALLOW pays", async () => {
  const fac = await fakeFacilitator();
  const s = await seller(fac.url);
  try {
    const capped = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "9999", rpcUrl });
    await assert.rejects(capped(`${s.url}/paid`, { headers: { "X-Nirium-Ref": "order-1" } }));
    const deny = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "10000", rpcUrl, policy: createRulesPolicy({ maxAmount: "5000" }) });
    await assert.rejects(deny(`${s.url}/paid`, { headers: { "X-Nirium-Ref": "order-2" } }), (e) => e instanceof X402PolicyError && e.outcome === "DENY");
    const capWithPolicy = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "9999", rpcUrl, policy: createRulesPolicy({ maxAmount: "20000" }) });
    await assert.rejects(capWithPolicy(`${s.url}/paid`, { headers: { "X-Nirium-Ref": "order-3" } }), (e) => e instanceof X402PolicyError && e.outcome === "DENY");
    assert.equal(fac.calls.verify + fac.calls.settle, 0);
    const allow = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "10000", rpcUrl, policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo], allowFeePayers: [feePayer] }) });
    const res = await allow(`${s.url}/paid`, { headers: { "X-Nirium-Ref": "order-4" } });
    assert.equal(res.status, 200);
    assert.equal(fac.calls.settle, 1);
    assert.equal(fac.calls.memo, "order-4");
  } finally { s.close(); fac.close(); }
});

test("a payTo without its USDC token account, or a facilitator that is down, answers 503 on paid routes only", async () => {
  const fac = await fakeFacilitator();
  state.ataExists = false;
  const s = await seller(fac.url);
  try {
    const r = await fetch(`${s.url}/paid`);
    assert.equal(r.status, 503);
    assert.match((await r.json()).hint, /token account/);
    assert.equal((await fetch(`${s.url}/health`)).status, 200);
  } finally { state.ataExists = true; s.close(); fac.close(); }
  const down = await seller("http://127.0.0.1:9");
  try {
    const r = await fetch(`${down.url}/paid`);
    assert.equal(r.status, 503);
    assert.equal((await fetch(`${down.url}/health`)).status, 200);
  } finally { down.close(); }
});

test("bindReceipt rebuilds the team's real devnet receipt from the chain, and refuses a signer that is not the payer", async () => {
  const evidence = JSON.parse(readFileSync(new URL("../../../evidence/2026-11-26/solana-devnet-binding.json", import.meta.url), "utf8"));
  const p = evidence.record.payment;
  const doc = await bindReceipt({ tx: p.tx, network: p.network, ref: evidence.record.purpose.ref, note: evidence.record.purpose.note, resource: p.x402.resource, labels: evidence.record.labels });
  assert.deepEqual(doc.record, evidence.record);
  assert.equal(doc.content_sha256, evidence.content_sha256);
  assert.equal((await verifyReceipt(doc, { requireSignature: false })).ok, true);
  await assert.rejects(bindReceipt({ tx: p.tx, network: p.network, ref: "x", signer: payer }), /not the transfer authority/);
});
