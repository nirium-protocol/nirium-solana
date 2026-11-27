// Unit tests for verify-svm-core.mjs, the one verifier the CLI, verifyReceipt() and the browser
// share. No network: the full check runs against recorded public devnet RPC answers for one of the
// team's self-test receipts (fixtures/devnet-sdk-selftest-rpc.json).
//
// node:crypto appears here only as the reference the core used before it moved to @noble, so
// each crypto test checks that the two agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getAddressDecoder, getAddressEncoder, address } from "@solana/kit";
import {
  canonicalize, contentSha256, ed25519Valid, base64ToBytes, bytesToBase64, verifyBinding, STATEMENT_PREFIX,
} from "../verify-svm-core.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const evidence = ["2026-11-26", "2026-11-27"].flatMap((d) =>
  readdirSync(new URL(`../../evidence/${d}/`, import.meta.url)).filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: `${d}/${f}`, doc: read(`../../evidence/${d}/${f}`) })));
const thirdParty = ["payai-mainnet-third-party.json", "devnet-v1-third-party.json"]
  .map((f) => ({ name: f, doc: read(`../fixtures/${f}`) }));
const recorded = read("../fixtures/devnet-sdk-selftest-rpc.json");
const selftest = read("../../evidence/2026-11-26/solana-devnet-sdk-binding.json");

// What the core did with node:crypto before this change.
const nodeSha = (record) => createHash("sha256").update(canonicalize(record), "utf8").digest("hex");
function nodeEd25519Valid(keyBase58, message, signatureBase64) {
  const raw = Buffer.from(getAddressEncoder().encode(address(keyBase58)));
  const sig = Buffer.from(signatureBase64, "base64");
  if (raw.length !== 32 || sig.length !== 64) return false;
  const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
  return verify(null, Buffer.from(message, "utf8"), pub, sig);
}
const outcome = (fn) => { try { return fn() ? "valid" : "invalid"; } catch { return "invalid"; } };

const clone = (d) => JSON.parse(JSON.stringify(d));
const failing = (res) => res.checks.filter((c) => !c.ok).map((c) => c.name).sort();

// A fetch that answers getGenesisHash and getTransaction from the recording.
async function withRecordedRpc(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    let result;
    if (method === "getGenesisHash") result = recorded.genesis;
    else if (method === "getTransaction") result = params[0] === recorded.tx.transaction.signatures[0] ? recorded.tx : null;
    else throw new Error(`unexpected RPC method ${method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("record hash matches every evidence receipt and fixture, and matches node:crypto", () => {
  assert.ok(evidence.length >= 7, `expected the evidence receipts, found ${evidence.length}`);
  for (const { name, doc } of [...evidence, ...thirdParty]) {
    assert.equal(contentSha256(doc.record), doc.content_sha256, name);
    assert.equal(contentSha256(doc.record), nodeSha(doc.record), name);
  }
});

test("hash agrees with node:crypto on records with non-ASCII text", () => {
  for (const note of ["pago de prueba ñandú", "日本語", "emoji 🧾", "quote \" and \\ slash", "  line sep"]) {
    const record = { purpose: { note, ref: "r" }, labels: [] };
    assert.equal(contentSha256(record), nodeSha(record), note);
  }
});

test("payer signatures on every evidence receipt verify, the same as with node:crypto", () => {
  for (const { name, doc } of evidence) {
    const a = doc.agent;
    assert.equal(a.statement, STATEMENT_PREFIX + doc.content_sha256, name);
    assert.equal(ed25519Valid(a.key, a.statement, a.signature), true, name);
    assert.equal(nodeEd25519Valid(a.key, a.statement, a.signature), true, name);
  }
});

test("ed25519: @noble and node:crypto agree on valid, tampered and foreign signatures", () => {
  const dec = getAddressDecoder();
  for (let i = 0; i < 64; i++) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const key = dec.decode(Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url"));
    const msg = STATEMENT_PREFIX + randomBytes(32).toString("hex") + (i % 2 ? " ñ" : "");
    const sig = sign(null, Buffer.from(msg, "utf8"), privateKey);
    assert.equal(ed25519Valid(key, msg, sig.toString("base64")), true);

    const flipped = Buffer.from(sig); flipped[i % 64] ^= 1 << (i % 8);
    assert.equal(ed25519Valid(key, msg, flipped.toString("base64")), false);
    assert.equal(nodeEd25519Valid(key, msg, flipped.toString("base64")), false);
    assert.equal(ed25519Valid(key, msg + "x", sig.toString("base64")), false);

    // Signed with @noble, checked by node:crypto.
    const secret = ed25519.utils.randomSecretKey();
    const nobleKey = dec.decode(ed25519.getPublicKey(secret));
    const nobleSig = bytesToBase64(ed25519.sign(new TextEncoder().encode(msg), secret));
    assert.equal(nodeEd25519Valid(nobleKey, msg, nobleSig), true);
    assert.equal(ed25519Valid(key, msg, nobleSig), false);
  }
});

test("ed25519: a non-canonical S (S + L) is rejected, as node:crypto rejects it", () => {
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const toLE = (n) => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; };
  const fromLE = (b) => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
  const a = selftest.agent;
  const sig = base64ToBytes(a.signature);
  const s = fromLE(sig.slice(32)) + L;
  assert.ok(s < 2n ** 256n);
  const bad = bytesToBase64(new Uint8Array([...sig.slice(0, 32), ...toLE(s)]));
  assert.equal(ed25519Valid(a.key, a.statement, bad), false);
  assert.equal(outcome(() => nodeEd25519Valid(a.key, a.statement, bad)), "invalid");
});

test("ed25519: malformed signatures give false, never true", () => {
  const a = selftest.agent;
  for (const s of ["", "not base64 ***", a.signature.slice(0, -4), bytesToBase64(new Uint8Array(64))]) {
    assert.equal(ed25519Valid(a.key, a.statement, s), false, JSON.stringify(s));
    assert.equal(outcome(() => nodeEd25519Valid(a.key, a.statement, s)), "invalid", JSON.stringify(s));
  }
});

test("ed25519: only the canonical base64 spelling of a valid signature is accepted", () => {
  const a = selftest.agent;
  // Buffer stops reading at the padding, so the old node:crypto path accepted this one.
  const trailing = a.signature + "AAAA";
  assert.equal(outcome(() => nodeEd25519Valid(a.key, a.statement, trailing)), "valid");
  for (const s of [trailing, a.signature.replace(/=+$/, ""), a.signature.slice(0, 20) + " " + a.signature.slice(20), a.signature + "\n"]) {
    assert.equal(ed25519Valid(a.key, a.statement, s), false, JSON.stringify(s));
  }
  assert.equal(ed25519Valid(a.key, a.statement, a.signature), true);
});

test("base64 helpers match Buffer", () => {
  for (let n = 0; n < 70; n++) {
    const bytes = randomBytes(n);
    assert.equal(bytesToBase64(bytes), bytes.toString("base64"));
    assert.deepEqual(base64ToBytes(bytes.toString("base64")), new Uint8Array(bytes));
  }
});

test("full check offline: the team's devnet self-test receipt is VALID", async () => {
  const res = await withRecordedRpc(() => verifyBinding(clone(selftest)));
  assert.deepEqual(failing(res), []);
  assert.equal(res.ok, true);
  assert.equal(res.checks.length, 27);
});

test("full check offline: each altered field fails for its own reason", async () => {
  const STATEMENT = "agent.statement == nirium-audit-v1:<content_sha256>";
  const HASH = "content_sha256 == sha256(canonical(record))";
  const rehash = (d) => { d.content_sha256 = contentSha256(d.record); return d; };
  const cases = [
    ["amount +1, hash not updated", (d) => { d.record.payment.amount = "10001"; },
      [HASH, "destination balance delta == payment.amount", "transfer.amount == payment.amount"]],
    ["amount +1, hash updated", (d) => { d.record.payment.amount = "10001"; rehash(d); },
      [STATEMENT, "destination balance delta == payment.amount", "transfer.amount == payment.amount"]],
    ["destination changed, hash updated", (d) => { d.record.payment.to = d.record.payment.from; rehash(d); },
      [STATEMENT, "transfer.destination == ATA(payment.to, asset, program)"]],
    ["purpose edited, hash not updated", (d) => { d.record.purpose.note = "something else"; }, [HASH]],
    ["purpose edited, hash updated", (d) => { d.record.purpose.ref = "order-99"; rehash(d); }, [STATEMENT]],
    ["memo changed, hash updated", (d) => { d.record.payment.x402.nonce = "other-ref"; rehash(d); },
      [STATEMENT, "Memo text == x402.nonce"]],
    ["index moved to the Memo, hash updated", (d) => { d.record.payment.locator.index = 3; rehash(d); },
      [STATEMENT, "ix 3 is transferChecked", "ix 3 program is Token or Token-2022"]],
    ["signature altered", (d) => { const s = base64ToBytes(d.agent.signature); s[10] ^= 1; d.agent.signature = bytesToBase64(s); },
      ["ed25519 signature by agent.key over agent.statement"]],
  ];
  for (const [name, mutate, expected] of cases) {
    const d = clone(selftest);
    mutate(d);
    const res = await withRecordedRpc(() => verifyBinding(d));
    assert.equal(res.ok, false, name);
    assert.deepEqual(failing(res), [...expected].sort(), name);
  }
});

test("browser-safe: the core and receipt modules use nothing Node-only, and load with browser exports", () => {
  for (const f of ["../verify-svm-core.mjs", "../sdk/receipt.mjs", "../sdk/networks.mjs"]) {
    // Comments may name what the file avoids, so only code is searched.
    const src = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /from\s+["']node:|import\(["']node:|require\(|\bBuffer\b|\bprocess\./, f);
  }
  // Resolve dependencies the way a browser bundler does (@solana/kit has its own browser build).
  const core = new URL("../verify-svm-core.mjs", import.meta.url).href;
  const receipt = new URL("../sdk/receipt.mjs", import.meta.url).href;
  const a = selftest.agent;
  const script = `
    const m = await import(${JSON.stringify(core)});
    await import(${JSON.stringify(receipt)});
    const doc = ${JSON.stringify(selftest)};
    if (m.contentSha256(doc.record) !== doc.content_sha256) throw new Error("hash");
    if (!m.ed25519Valid(${JSON.stringify(a.key)}, ${JSON.stringify(a.statement)}, ${JSON.stringify(a.signature)})) throw new Error("sig");
    console.log("ok");`;
  const r = spawnSync(process.execPath, ["--conditions=browser", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "ok");
});
