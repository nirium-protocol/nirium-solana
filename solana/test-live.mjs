#!/usr/bin/env node
// test-live.mjs - runs verify-svm-receipt.mjs (the real CLI, real RPC) against
// fixtures/payai-mainnet-third-party.json and one-field mutations of it.
// Expected: the base case passes with --no-sig, every mutation fails with exit 1.
// The signature tests use a throwaway in-memory ed25519 key that is never saved.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { contentSha256 } from "./verify-svm-receipt.mjs";

const base = JSON.parse(readFileSync("fixtures/payai-mainnet-third-party.json", "utf8"));
const clone = () => JSON.parse(JSON.stringify(base));
const rehash = (d) => { d.content_sha256 = contentSha256(d.record); return d; };
const flipLast = (s) => s.slice(0, -1) + (s.endsWith("1") ? "2" : "1");

const cases = [];
const add = (name, doc, flags, expect) => cases.push({ name, doc, flags, expect });

add("base (real PayAI mainnet tx), --no-sig", clone(), ["--no-sig"], 0);
{ const d = clone(); d.record.payment.locator.index = 3; add("wrong index (3 = Memo)", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.locator.index = 0; add("wrong index (0 = ComputeBudget)", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.locator.index = 9; add("index out of range", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.amount = String(BigInt(d.record.payment.amount) + 1n); add("wrong amount (+1)", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.asset = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"; add("wrong mint (USDT)", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.to = d.record.payment.from; add("wrong destination (to = payer)", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.x402.nonce = d.record.payment.x402.nonce + "x"; add("wrong memo", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.from = d.record.payment.to; add("wrong from/authority", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.decimals = 9; add("wrong decimals", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.locator.txVersion = 1; add("wrong txVersion", rehash(d), ["--no-sig"], 1); }
{ const d = clone(); d.record.purpose.ref = "edited"; add("record edited, hash not updated", d, ["--no-sig"], 1); }
{ const d = clone(); d.record.payment.tx = flipLast(d.record.payment.tx); add("tx signature that does not exist", rehash(d), ["--no-sig"], 1); }
add("mainnet binding checked against devnet RPC", clone(), ["--no-sig", "--rpc", "https://api.devnet.solana.com"], 1);

// Version-1 tx (devnet, from x402 issue #4383; third party, fixture only).
const v1 = JSON.parse(readFileSync("fixtures/devnet-v1-third-party.json", "utf8"));
const cloneV1 = () => JSON.parse(JSON.stringify(v1));
add("v1 tx base (devnet, index 0), --no-sig", cloneV1(), ["--no-sig"], 0);
{ const d = cloneV1(); d.record.payment.locator.index = 1; add("v1 tx, index 1 (Memo)", rehash(d), ["--no-sig"], 1); }
{ const d = cloneV1(); d.record.payment.locator.txVersion = 0; add("v1 tx recorded as txVersion 0", rehash(d), ["--no-sig"], 1); }
{ const d = cloneV1(); d.record.payment.amount = "1001"; add("v1 tx, wrong amount", rehash(d), ["--no-sig"], 1); }

// Signature path with a throwaway key.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
const throwawayAddr = getAddressDecoder().decode(raw);
const signDoc = (d, key = privateKey) => {
  const statement = "nirium-audit-v1:" + d.content_sha256;
  d.agent = { alg: "ed25519-solana", key: throwawayAddr, statement,
    signature: sign(null, Buffer.from(statement, "utf8"), key).toString("base64") };
  return d;
};
add("signed by another key: sig valid, signer != from", signDoc(clone()), [], 1);
{ const d = signDoc(clone()); const s = Buffer.from(d.agent.signature, "base64"); s[0] ^= 1; d.agent.signature = s.toString("base64"); add("tampered signature", d, [], 1); }
add("no agent block without --no-sig", clone(), [], 1);

let failures = 0;
for (const [i, c] of cases.entries()) {
  const f = `fixtures/case-${String(i).padStart(2, "0")}.json`;
  writeFileSync(f, JSON.stringify(c.doc, null, 2) + "\n");
  const r = spawnSync(process.execPath, ["verify-svm-receipt.mjs", f, ...c.flags], { encoding: "utf8" });
  const ok = r.status === c.expect;
  if (!ok) failures++;
  const fails = (r.stdout || "").split("\n").filter((l) => l.startsWith("FAIL")).map((l) => l.slice(6).split("  [")[0]);
  console.log(`${ok ? "OK  " : "BAD "} exit=${r.status} expect=${c.expect}  ${c.name}${fails.length ? "  -> FAIL: " + fails.join(" | ") : ""}${r.stderr ? "  stderr: " + r.stderr.trim() : ""}`);
  await new Promise((res) => setTimeout(res, 400));
}
console.log(`\n${cases.length - failures}/${cases.length} as expected`);
process.exit(failures ? 1 : 0);
