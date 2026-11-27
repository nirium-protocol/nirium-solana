// Tests for the Solana pre-sign gate. No network: a local fake RPC answers only the mint account,
// and the blockhash comes in extra.recentBlockhash, so the real @x402/svm 2.32.0 ExactSvmScheme
// builds the real transaction offline. Vector numbers (V, R, D) follow the spec's section 2.6.
// In every refusal the base signer (a spy) must never be called.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { verify as edVerify, createPublicKey } from "node:crypto";
import {
  generateKeyPairSigner, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder,
  getTransactionDecoder, getBase64Encoder, getAddressEncoder,
} from "@solana/kit";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { createPolicyGatedSigner, describeAuthorization, associatedTokenAddress, X402PolicyError, computeContextHash } from "../svm-policy.mjs";
import { createPolicyX402Fetch } from "../x402-fetch.mjs";
import { createRulesPolicy } from "../rules-policy.mjs";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_DEV = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const USDC_MAIN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM = "11111111111111111111111111111111";
const URL_ = "https://policy.test/paid";

let rpcUrl, rpcServer, payer, payTo, feePayer, blockhash;

// 82-byte SPL mint: no authority, supply 0, decimals 6, initialized.
const mintData = () => { const b = Buffer.alloc(82); b[44] = 6; b[45] = 1; return b.toString("base64"); };
before(async () => {
  rpcServer = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const m = JSON.parse(body);
      const result = m.method === "getAccountInfo"
        ? { context: { slot: 1 }, value: { data: [mintData(), "base64"], executable: false, lamports: 1461600, owner: TOKEN, rentEpoch: 0, space: 82 } }
        : null;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...(result ? { result } : { error: { code: -32601, message: `fake RPC: ${m.method}` } }) }));
    });
  });
  await new Promise((r) => rpcServer.listen(0, "127.0.0.1", r));
  rpcUrl = `http://127.0.0.1:${rpcServer.address().port}`;
  payer = await generateKeyPairSigner();
  payTo = (await generateKeyPairSigner()).address;
  feePayer = (await generateKeyPairSigner()).address;
  blockhash = (await generateKeyPairSigner()).address;
});
after(() => rpcServer.close());

const requirements = (over = {}) => ({
  scheme: "exact", network: DEVNET, asset: USDC_DEV, payTo, amount: "10000", maxTimeoutSeconds: 120,
  ...over,
  extra: { feePayer, memo: "order-42", recentBlockhash: blockhash, transactionVersions: [0], ...(over.extra || {}) },
});

function spy(base = payer) {
  const s = { calls: 0, address: base.address, seen: [] };
  s.signTransactions = async (txs, cfg) => { s.calls++; s.seen.push(txs); return base.signTransactions(txs, cfg); };
  return s;
}
const allowBound = (over = {}) => ({ async evaluate(c) { return { decision: "ALLOW", contextHash: c.contextHash, ...over }; } });

/** Runs the real ExactSvmScheme through a gate. */
async function pay(policy, { req = requirements(), base = spy(), told } = {}) {
  const records = [];
  const p = { ...policy, onDecision: (r) => { records.push(r.outcome); return policy.onDecision?.(r); } };
  let refused;
  const gated = createPolicyGatedSigner(base, p, () => ({ url: URL_, method: "GET", requirements: told ?? req }), (e) => { refused = e; });
  try {
    const result = await new ExactSvmScheme(gated, { transactionVersions: [0], rpcUrl }).createPaymentPayload(2, { ...req });
    return { result, records, base };
  } catch (e) {
    return { error: refused ?? e, records, base };
  }
}

/** The real message bytes the package builds for `req` (captured from an ALLOW run). */
async function realMessage(req = requirements()) {
  const base = spy();
  const { error } = await pay(allowBound(), { req, base });
  assert.equal(error, undefined);
  return base.seen[0][0].messageBytes;
}

/** Calls the gate directly with a tampered message; asserts CONTEXT_MISMATCH and no signature. */
async function assertTamperRefused(name, mutate, { req = requirements(), count = 1 } = {}) {
  const bytes = await realMessage(req);
  const msg = structuredClone(getCompiledTransactionMessageDecoder().decode(bytes));
  const out = (await mutate(msg)) ?? msg;
  const tampered = out instanceof Uint8Array ? out : new Uint8Array(getCompiledTransactionMessageEncoder().encode(out));
  const base = spy();
  let asked = 0;
  const policy = { async evaluate(c) { asked++; return { decision: "ALLOW", contextHash: c.contextHash }; } };
  const gated = createPolicyGatedSigner(base, policy, () => ({ url: URL_, method: "GET", requirements: req }));
  const txs = Array.from({ length: count }, () => ({ messageBytes: tampered, signatures: {} }));
  await assert.rejects(gated.signTransactions(txs), (e) => e instanceof X402PolicyError && e.outcome === "CONTEXT_MISMATCH", name);
  assert.equal(base.calls, 0, `${name}: signer called`);
  assert.equal(asked, 0, `${name}: engine asked`);
}

const idx = (msg, addr) => msg.staticAccounts.findIndex((a) => String(a) === String(addr));
const transfer = (msg) => msg.instructions[2];
const extraIx = (msg, programAddr, data = new Uint8Array([2, 0, 0, 0])) => {
  let p = idx(msg, programAddr);
  if (p < 0) { msg.staticAccounts.push(programAddr); p = msg.staticAccounts.length - 1; msg.header.numReadonlyNonSignerAccounts++; }
  msg.instructions.splice(3, 0, { programAddressIndex: p, accountIndices: [1], data });
};

// ── Valid (V) ────────────────────────────────────────────────────────────────
test("V2: ALLOW bound to the transaction signs exactly once (server memo)", async () => {
  const { result, records, base, error } = await pay(allowBound());
  assert.equal(error, undefined);
  assert.equal(base.calls, 1);
  assert.deepEqual(records, ["ALLOWED", "SIGNED"]);
  assert.ok(result.payload.transaction);
});

test("V1: without a server memo the memo is a 32-hex nonce, and it is allowed", async () => {
  let seen;
  const { error } = await pay({ async evaluate(c) { seen = c.authorization.memo; return { decision: "ALLOW", contextHash: c.contextHash }; } }, { req: requirements({ extra: { memo: undefined } }) });
  assert.equal(error, undefined);
  assert.match(seen, /^[0-9a-f]{32}$/);
});

test("V2b: a 200-byte server memo is carried byte for byte", async () => {
  const memo = "m".repeat(200);
  let seen;
  const { error } = await pay({ async evaluate(c) { seen = c.authorization.memo; return { decision: "ALLOW", contextHash: c.contextHash }; } }, { req: requirements({ extra: { memo } }) });
  assert.equal(error, undefined);
  assert.equal(seen, memo);
});

test("V3/V4: mainnet USDC and an amount exactly at the limit are allowed", async () => {
  const a = await pay(createRulesPolicy({ maxAmount: "10000" }), { req: requirements({ network: MAINNET, asset: USDC_MAIN }) });
  assert.equal(a.error, undefined);
  assert.equal(a.base.calls, 1);
});

test("the policy sees what is about to be signed, decoded from the bytes", async () => {
  let a;
  await pay({ async evaluate(c) { a = c.authorization; return { decision: "DENY" }; } });
  assert.equal(a.amount, "10000");
  assert.equal(a.mint, USDC_DEV);
  assert.equal(a.to, payTo);
  assert.equal(a.feePayer, feePayer);
  assert.equal(a.destinationAta, String(await associatedTokenAddress(payTo, USDC_DEV, TOKEN)));
  assert.equal(a.memo, "order-42");
  assert.match(a.payloadHash, /^[0-9a-f]{64}$/);
});

// ── Policy refusals (R) ──────────────────────────────────────────────────────
test("R1/R3/R5/R9: above the limit, stranger payTo, unknown fee payer, WAIT: nothing signed", async () => {
  for (const [name, policy, outcome] of [
    ["R1 above max", createRulesPolicy({ maxAmount: "9999" }), "DENY"],
    ["R3 payTo not allowed", createRulesPolicy({ maxAmount: "10000", allowPayTo: [feePayer] }), "DENY"],
    ["R5 fee payer not allowed", createRulesPolicy({ maxAmount: "10000", allowFeePayers: [payTo] }), "DENY"],
    ["R9 WAIT", createRulesPolicy({ maxAmount: "20000", approvalAbove: "5000" }), "WAIT"],
  ]) {
    const { error, base } = await pay(policy);
    assert.equal(error?.outcome, outcome, name);
    assert.equal(base.calls, 0, name);
  }
});

test("R2/R4/R7: unknown mint, payer as fee payer, mainnet mint on devnet: refused before the engine", async () => {
  let asked = 0;
  const policy = { async evaluate(c) { asked++; return { decision: "ALLOW", contextHash: c.contextHash }; } };
  for (const [name, req] of [
    ["R2 unknown mint", requirements({ asset: USDC_MAIN })],
    ["R7 devnet network with mainnet mint", requirements({ network: DEVNET, asset: USDC_MAIN })],
    ["R4 payer is fee payer", requirements({ extra: { feePayer: payer.address } })],
  ]) {
    const { error, base } = await pay(policy, { req });
    assert.ok(error, name);
    assert.equal(base.calls, 0, name);
  }
  assert.equal(asked, 0);
});

test("R8: a facilitator that only accepts v1 transactions gets no signature", async () => {
  const { error, base } = await pay(allowBound(), { req: requirements({ extra: { transactionVersions: [1] } }) });
  assert.ok(error);
  assert.equal(base.calls, 0);
});

// ── Gate semantics (same contract as Stellar and Avalanche) ──────────────────
test("unbound, expired, stale, version unavailable, timeout, engine error, malformed, bad clock: nothing signed", async () => {
  const fixed = 1_000_000;
  const allowV = (v) => async (c) => ({ decision: "ALLOW", contextHash: c.contextHash, policyVersion: v });
  for (const [policy, outcome] of [
    [{ async evaluate() { return { decision: "ALLOW", contextHash: "00".repeat(32) }; } }, "UNBOUND"],
    [{ now: () => fixed, async evaluate(c) { return { decision: "ALLOW", contextHash: c.contextHash, expiresAt: fixed }; } }, "EXPIRED"],
    [{ requireExpiry: true, ...allowBound() }, "EXPIRED"],
    [{ evaluate: allowV("v1"), currentVersion: async () => "v2" }, "STALE"],
    [{ evaluate: allowV("v1"), currentVersion: async () => { throw new Error("down"); } }, "VERSION_UNAVAILABLE"],
    [{ timeoutMs: 20, evaluate: () => new Promise(() => {}) }, "TIMEOUT"],
    [{ async evaluate() { throw new Error("engine down"); } }, "ENGINE_ERROR"],
    [{ async evaluate() { return { decision: "MAYBE" }; } }, "MALFORMED"],
    [{ now: () => NaN, ...allowBound() }, "CLOCK_INVALID"],
  ]) {
    const { error, base } = await pay(policy);
    assert.equal(error?.outcome, outcome);
    assert.equal(base.calls, 0, outcome);
  }
});

test("a signer that changes address during evaluation signs nothing", async () => {
  const base = spy();
  const other = (await generateKeyPairSigner()).address;
  const { error } = await pay({ async evaluate(c) { base.address = other; return { decision: "ALLOW", contextHash: c.contextHash }; } }, { base });
  assert.equal(error?.outcome, "SIGNER_CHANGED");
  assert.equal(base.calls, 0);
});

test("an observer that throws or rejects cannot block the payment", async () => {
  assert.equal((await pay({ ...allowBound(), onDecision() { throw new Error("bug"); } })).error, undefined);
  assert.equal((await pay({ ...allowBound(), onDecision: async () => { throw new Error("async bug"); } })).error, undefined);
});

// ── Tampered transactions (D): refused before the engine is even asked ─────
test("D1 amount changed", () => assertTamperRefused("D1", (m) => { transfer(m).data = Uint8Array.from([12, 0x11, 0x27, 0, 0, 0, 0, 0, 0, 6]); }));
test("D2 mint changed", () => assertTamperRefused("D2", (m) => { m.staticAccounts[transfer(m).accountIndices[1]] = USDC_MAIN; }));
test("D3 destination is another owner's ATA", async () => { const a = await associatedTokenAddress(feePayer, USDC_DEV, TOKEN); return assertTamperRefused("D3", (m) => { m.staticAccounts[transfer(m).accountIndices[2]] = a; }); });
test("D4 destination is a token account of payTo that is not its ATA", async () => { const r = (await generateKeyPairSigner()).address; return assertTamperRefused("D4", (m) => { m.staticAccounts[transfer(m).accountIndices[2]] = r; }); });
test("D5 source is not the payer's ATA", async () => { const r = (await generateKeyPairSigner()).address; return assertTamperRefused("D5", (m) => { m.staticAccounts[transfer(m).accountIndices[0]] = r; }); });
test("D6 authority is not the payer", () => assertTamperRefused("D6", (m) => { transfer(m).accountIndices = [...transfer(m).accountIndices.slice(0, 3), 0]; }));
test("D7 decimals differ", () => assertTamperRefused("D7", (m) => { const d = Uint8Array.from(transfer(m).data); d[9] = 9; transfer(m).data = d; }));
test("D8 Transfer instead of TransferChecked", () => assertTamperRefused("D8", (m) => { transfer(m).data = Uint8Array.from([3, 0x10, 0x27, 0, 0, 0, 0, 0, 0]); }));
test("D9 extra System transfer from the payer", () => assertTamperRefused("D9", (m) => extraIx(m, SYSTEM, new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]))));
test("D10 extra SPL Approve", () => assertTamperRefused("D10", (m) => extraIx(m, TOKEN, new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0, 0]))));
test("D11 extra SetAuthority / CloseAccount", () => assertTamperRefused("D11", (m) => extraIx(m, TOKEN, new Uint8Array([9]))));
test("D12 a second TransferChecked", () => assertTamperRefused("D12", (m) => { m.instructions.splice(3, 0, structuredClone(transfer(m))); }));
test("D13 a guard instruction from another program", async () => { const g = (await generateKeyPairSigner()).address; return assertTamperRefused("D13", (m) => extraIx(m, g)); });
test("D14 instructions reordered", () => assertTamperRefused("D14", (m) => { const [a, b, c, d] = m.instructions; m.instructions = [a, b, d, c]; }));
test("D15 a different memo, or two memos", async () => {
  await assertTamperRefused("D15a", (m) => { m.instructions[3].data = new TextEncoder().encode("order-43"); });
  await assertTamperRefused("D15b", (m) => { m.instructions.push(structuredClone(m.instructions[3])); });
});
test("D16 fee payer changed", async () => { const r = (await generateKeyPairSigner()).address; return assertTamperRefused("D16", (m) => { m.staticAccounts[0] = r; }); });
test("D17 three required signatures", () => assertTamperRefused("D17", (m) => { m.header.numSignerAccounts = 3; }));
test("D18 address lookup tables", async () => { const t = (await generateKeyPairSigner()).address; return assertTamperRefused("D18", (m) => { m.addressTableLookups = [{ lookupTableAddress: t, writableIndexes: [0], readonlyIndexes: [] }]; }); });
test("D19 durable nonce instruction", () => assertTamperRefused("D19", (m) => extraIx(m, SYSTEM, new Uint8Array([4, 0, 0, 0]))));
test("D20 legacy and v1 messages", async () => {
  await assertTamperRefused("D20a legacy", (m) => { m.version = "legacy"; delete m.addressTableLookups; });
  await assertTamperRefused("D20b v1 prefix", async () => { const b = Uint8Array.from(await realMessage()); b[0] = 0x81; return b; });
});
test("D21 compute unit price above the cap", () => assertTamperRefused("D21", (m) => { m.instructions[1].data = Uint8Array.from([3, 0, 0, 0, 0, 1, 0, 0, 0]); }));
test("D22 two transactions in one signing call", () => assertTamperRefused("D22", () => undefined, { count: 2 }));
test("D23 TransferChecked data with an extra byte", () => assertTamperRefused("D23", (m) => { transfer(m).data = Uint8Array.from([...transfer(m).data, 0]); }));
test("D24 Token-2022 program for classic USDC", () => assertTamperRefused("D24", (m) => { m.staticAccounts[transfer(m).programAddressIndex] = TOKEN_2022; }));

test("contextHash binds url, method and the message hash", () => {
  const h = computeContextHash(URL_, "GET", "ab".repeat(32));
  assert.notEqual(h, computeContextHash(URL_, "POST", "ab".repeat(32)));
  assert.notEqual(h, computeContextHash(URL_, "GET", "cd".repeat(32)));
});

// ── End to end through @x402/fetch against a local seller ────────────────────
async function withSeller(fn) {
  const seen = { paid: 0, payloads: [] };
  const server = createServer((req, res) => {
    const sig = req.headers["payment-signature"];
    if (!sig) {
      const pr = { x402Version: 2, resource: { url: "http://127.0.0.1/paid" }, accepts: [requirements()] };
      res.writeHead(402, { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr), "content-type": "application/json" });
      return res.end("{}");
    }
    seen.paid++; seen.payloads.push(decodePaymentSignatureHeader(sig));
    res.writeHead(200, { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "fake", network: DEVNET }), "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/paid`, seen); } finally { server.close(); }
}

test("e2e: DENY never sends a payment; ALLOW sends a transaction the payer really signed and the fee payer did not", async () => {
  await withSeller(async (url, seen) => {
    const base = spy();
    const deny = createPolicyX402Fetch({ signer: base, policy: createRulesPolicy({ maxAmount: "1" }), network: DEVNET, rpcUrl });
    await assert.rejects(deny(url), (e) => e instanceof X402PolicyError && e.outcome === "DENY");
    assert.equal(seen.paid, 0);
    assert.equal(base.calls, 0);

    const allow = createPolicyX402Fetch({ signer: base, policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo], allowFeePayers: [feePayer] }), network: DEVNET, rpcUrl });
    const res = await allow(url);
    assert.equal(res.status, 200);
    assert.equal(seen.paid, 1);
    const wire = getBase64Encoder().encode(seen.payloads[0].payload.transaction);
    const tx = getTransactionDecoder().decode(wire);
    const payerSig = tx.signatures[payer.address];
    assert.ok(payerSig, "payer signature present");
    assert.equal(tx.signatures[feePayer], null, "fee payer has not signed yet");
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(getAddressEncoder().encode(payer.address))]);
    assert.equal(edVerify(null, Buffer.from(tx.messageBytes), createPublicKey({ key: spki, format: "der", type: "spki" }), Buffer.from(payerSig)), true);
    const auth = await describeAuthorization(new Uint8Array(tx.messageBytes), requirements(), payer.address);
    assert.equal(auth.amount, "10000");
  });
});
