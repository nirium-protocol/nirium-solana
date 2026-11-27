// Decision receipts from REAL policy decisions: the same offline pay loop as sdk.test.mjs (fake RPC
// and facilitator), so the receipts are built from exactly what the policy hands to onDecision.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { verify as edVerify, createPublicKey } from "node:crypto";
import express from "express";
import { generateKeyPairSigner, getTransactionDecoder, getBase64Encoder, getAddressEncoder } from "@solana/kit";
import { describeAuthorization, associatedTokenAddress } from "../../policy/svm-policy.mjs";
import {
  x402Serve, createX402Fetch, createRulesPolicy, X402PolicyError, DEVNET,
  bindDecision, verifyDecision, decisionRecord, collectDecisions, DECISION_VERSION,
} from "../index.mjs";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
let payer, other, payTo, payToAta, feePayer, blockhash, rpc, rpcUrl, fac, shop;

async function listen(s) { await new Promise((r) => s.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${s.address().port}`; }
const accountReply = (data, owner) => ({ context: { slot: 1 }, value: { data: [data.toString("base64"), "base64"], executable: false, lamports: 2039280, owner, rentEpoch: 0, space: data.length } });

before(async () => {
  payer = await generateKeyPairSigner();
  other = await generateKeyPairSigner();
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
        else if (addr === payToAta) result = accountReply(Buffer.alloc(165), TOKEN);
        else result = { context: { slot: 1 }, value: null };
      } else if (m.method === "getLatestBlockhash") result = { context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 100 } };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...(result ? { result } : { error: { code: -32601, message: `fake RPC: ${m.method}` } }) }));
    });
  });
  rpcUrl = await listen(rpc);
  const facServer = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.url.endsWith("/supported")) return send({ kinds: [{ x402Version: 2, scheme: "exact", network: DEVNET, extra: { feePayer, transactionVersions: [0, 1] } }], extensions: [], signers: { "solana:*": [feePayer] } });
      const { paymentPayload: p, paymentRequirements: r } = JSON.parse(body);
      const tx = getTransactionDecoder().decode(getBase64Encoder().encode(p.payload.transaction));
      const sig = tx.signatures[payer.address];
      const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(getAddressEncoder().encode(payer.address))]);
      let ok = !!sig && edVerify(null, Buffer.from(tx.messageBytes), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(sig));
      try { await describeAuthorization(new Uint8Array(tx.messageBytes), r, payer.address); } catch { ok = false; }
      if (req.url.endsWith("/verify")) return send({ isValid: ok, payer: payer.address, ...(ok ? {} : { invalidReason: "bad" }) });
      return send(ok ? { success: true, transaction: "5".repeat(87), network: DEVNET, payer: payer.address } : { success: false, errorReason: "bad", transaction: "", network: DEVNET });
    });
  });
  fac = { server: facServer, url: await listen(facServer) };
  const app = express();
  app.use(x402Serve({ payTo, network: DEVNET, facilitatorUrl: fac.url, rpcUrl, routes: { "GET /paid": "$0.01" } }));
  app.get("/paid", (req, res) => res.json({ ok: true }));
  const shopServer = createServer(app);
  shop = { server: shopServer, url: await listen(shopServer) };
});
after(() => { rpc.close(); fac.server.close(); shop.server.close(); });

async function attempt(rules, ref) {
  const col = collectDecisions();
  const pay = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "10000", rpcUrl, policy: createRulesPolicy({ ...rules, onDecision: col.onDecision }) });
  let error;
  try { await pay(`${shop.url}/paid`, { headers: { "X-Nirium-Ref": ref } }); } catch (e) { error = e; }
  return { records: col.records, error };
}

test("a DENY that never reached the chain gets a payer-signed receipt saying what it would have paid and why", async () => {
  const { records, error } = await attempt({ maxAmount: "5000" }, "order-deny");
  assert.ok(error instanceof X402PolicyError && error.outcome === "DENY");
  assert.deepEqual(records.map((r) => r.outcome), ["DENY"]);
  const { doc, record } = await bindDecision(records[0], { signer: payer, ref: "order-deny", labels: ["test"] });
  assert.equal(doc.version, DECISION_VERSION);
  assert.equal(doc.network, DEVNET);
  assert.deepEqual(record.decision, { outcome: "DENY", policyVersion: "rules-v1", reason: "amount 10000 above limit 5000" });
  assert.equal(record.intent.amount, "10000");
  assert.equal(record.intent.asset, USDC);
  assert.equal(record.intent.from, String(payer.address));
  assert.equal(record.intent.to, String(payTo));
  assert.equal(record.intent.nonce, "order-deny");
  assert.equal(record.intent.resource, `${shop.url}/paid`);
  assert.match(record.intent.payloadHash, /^[0-9a-f]{64}$/);
  const v = await verifyDecision(doc);
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
});

test("WAIT, and an ALLOW followed by SIGNED, each get their own receipt", async () => {
  const w = await attempt({ maxAmount: "20000", approvalAbove: "5000" }, "order-wait");
  assert.deepEqual(w.records.map((r) => r.outcome), ["WAIT"]);
  const wait = await bindDecision(w.records[0], { signer: payer, ref: "order-wait" });
  assert.equal(wait.record.decision.outcome, "WAIT");
  assert.equal((await verifyDecision(wait.doc)).ok, true);

  const a = await attempt({ maxAmount: "10000", allowPayTo: [payTo], allowFeePayers: [feePayer] }, "order-allow");
  assert.equal(a.error, undefined);
  assert.deepEqual(a.records.map((r) => r.outcome), ["ALLOWED", "SIGNED"]);
  for (const r of a.records) {
    const { doc } = await bindDecision(r, { signer: payer, ref: "order-allow" });
    assert.equal((await verifyDecision(doc)).ok, true);
  }
});

test("hash-only receipts keep the content private and still verify; the held record must match", async () => {
  const { records } = await attempt({ maxAmount: "5000" }, "order-private");
  const { doc, record } = await bindDecision(records[0], { signer: payer, ref: "order-private", hashOnly: true });
  assert.equal(doc.record, undefined);
  assert.equal((await verifyDecision(doc)).ok, true);
  assert.equal((await verifyDecision(doc, { record })).ok, true);
  const other = { ...record, decision: { ...record.decision, outcome: "ALLOWED" } };
  assert.equal((await verifyDecision(doc, { record: other })).ok, false);
});

test("an edited decision, an altered signature or a key that is not the payer fail", async () => {
  const { records } = await attempt({ maxAmount: "5000" }, "order-tamper");
  const { doc } = await bindDecision(records[0], { signer: payer, ref: "order-tamper" });
  const flipped = structuredClone(doc); flipped.record.decision.outcome = "ALLOWED";
  const v1 = await verifyDecision(flipped);
  assert.equal(v1.ok, false);
  assert.ok(v1.checks.some((c) => c.name.startsWith("content_sha256") && !c.ok));
  const badSig = structuredClone(doc); badSig.agent.signature = badSig.agent.signature.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  assert.equal((await verifyDecision(badSig)).ok, false);
  await assert.rejects(bindDecision(records[0], { signer: other, ref: "x" }), /is not the payer/);
});

test("a refusal before any payment was decoded has nothing to describe", () => {
  assert.equal(decisionRecord({ outcome: "CONTEXT_MISMATCH", error: "not an exact payment" }), null);
});
