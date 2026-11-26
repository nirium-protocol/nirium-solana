#!/usr/bin/env node
// find-payai-tx.mjs - read-only. Finds a recent x402 `exact` settlement by a
// facilitator fee payer (default: PayAI mainnet) with a top-level
// TransferChecked + one Memo, and writes an UNSIGNED binding built from it to
// fixtures/, for testing verify-svm-receipt.mjs with --no-sig.
// The binding's `from` is the real third-party payer: it is not ours, it is not
// usage, and it must never be cited as traction. labels = ["third-party-fixture"].
//
// Usage: node find-payai-tx.mjs [--fee-payer <base58>] [--rpc <url>] [--limit 40]

import { writeFileSync } from "node:fs";
import { contentSha256 } from "./verify-svm-receipt.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FEE_PAYER = opt("--fee-payer", "CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww");
const RPC = opt("--rpc", "https://api.mainnet-beta.solana.com");
const LIMIT = Number(opt("--limit", "40"));
const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const TOKEN = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
  throw new Error(`${method}: rate limited`);
}

const sigs = await rpc("getSignaturesForAddress", [FEE_PAYER, { limit: LIMIT, commitment: "finalized" }]);
console.log(`fee payer ${FEE_PAYER}: ${sigs.length} recent signatures`);
const versions = {};
let found = null;
for (const s of sigs) {
  if (s.err) continue;
  let tx;
  try {
    tx = await rpc("getTransaction", [s.signature, { commitment: "finalized", maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]);
  } catch (e) {
    console.log(`  ${s.signature.slice(0, 16)}...  getTransaction error: ${e.message}`);
    versions["error"] = (versions["error"] ?? 0) + 1;
    await sleep(300);
    continue;
  }
  await sleep(300);
  if (!tx) continue;
  const v = tx.version === undefined ? "legacy" : tx.version;
  versions[v] = (versions[v] ?? 0) + 1;
  const ixs = tx.transaction.message.instructions;
  const tcIdx = ixs.findIndex((i) => TOKEN.includes(i.programId) && i.parsed?.type === "transferChecked");
  const memos = ixs.filter((i) => i.programId === MEMO);
  const shape = ixs.map((i) => i.parsed?.type ?? (i.program || i.programId.slice(0, 6))).join(",");
  console.log(`  ${s.signature.slice(0, 16)}...  v=${v}  [${shape}]`);
  if (!found && tcIdx >= 0 && memos.length === 1 && typeof memos[0].parsed === "string") {
    found = { sig: s.signature, tx, tcIdx, memo: memos[0].parsed, v };
  }
}
console.log("versions seen:", JSON.stringify(versions));
if (!found) { console.log("no exact settlement with TransferChecked + Memo in this window"); process.exit(1); }

const info = found.tx.transaction.message.instructions[found.tcIdx].parsed.info;
// The verifier checks destination == ATA(to, mint, program); recover `to` from
// the token-balance owner of the destination account.
const keys = found.tx.transaction.message.accountKeys;
const destIdx = keys.findIndex((k) => k.pubkey === info.destination);
const owner = found.tx.meta.postTokenBalances.find((b) => b.accountIndex === destIdx)?.owner;
const record = {
  labels: ["third-party-fixture"],
  payment: {
    amount: info.tokenAmount.amount,
    asset: info.mint,
    decimals: info.tokenAmount.decimals,
    from: info.authority,
    locator: { index: found.tcIdx, kind: "svm-top-level-ix", txVersion: found.v },
    network: NETWORK,
    to: owner,
    tx: found.sig,
    x402: { nonce: found.memo, resource: "unknown (third-party tx)", scheme: "exact" },
  },
  purpose: { note: "fixture built from a public third-party PayAI settlement; not ours, not usage", ref: "fixture-payai-mainnet" },
};
const binding = {
  version: "nirium-payment-binding-v1",
  content_sha256: contentSha256(record),
  record,
  agent: null,
  network: NETWORK,
};
writeFileSync("fixtures/payai-mainnet-third-party.json", JSON.stringify(binding, null, 2) + "\n");
console.log(`picked ${found.sig} (v=${found.v}, TransferChecked at top-level index ${found.tcIdx}); wrote fixtures/payai-mainnet-third-party.json`);
