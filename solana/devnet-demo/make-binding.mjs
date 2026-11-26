#!/usr/bin/env node
// make-binding.mjs - builds a "nirium-payment-binding-v1" document for a settled
// x402 exact payment on Solana and signs it with the payer's key.
//
// Usage:
//   NIRIUM_PAYER_KEYPAIR=<path to solana-keygen JSON> \
//   node make-binding.mjs --tx <signature> --ref <purpose.ref> [--to <payTo wallet>]
//     [--network <caip2>] [--rpc <url>] [--resource <url>] [--note <text>]
//     [--label selftest] [--index <n>] [--out binding.json] [--no-sign] [--wait 60]
//
// What it does:
// - Reads the tx (finalized, maxSupportedTransactionVersion 1, jsonParsed); waits up
//   to --wait seconds for finality.
// - Finds the single top-level TransferChecked (or uses --index) and the single
//   top-level Memo; the Memo text becomes x402.nonce.
// - `to` defaults to the owner of the destination token account (from token
//   balances); pass --to to state it explicitly. The verifier re-derives the ATA.
// - Builds `record` with keys already in canonical order, so JSON.stringify(record)
//   equals canonical(record) and verify-audit-cid computes the same hash.
// - Signs "nirium-audit-v1:<content_sha256>" (UTF-8) with ed25519. Refuses to sign
//   if the key is not the transfer authority. The key is never printed.
// --no-sign writes the document without the agent block (for testing with
//   verify-svm-receipt.mjs --no-sig).

import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { canonicalize, contentSha256, VERSION, STATEMENT_PREFIX } from "../verify-svm-receipt.mjs";

const RPCS = {
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "https://api.devnet.solana.com",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
};
const TOKEN = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const txSig = opt("--tx");
const ref = opt("--ref");
const network = opt("--network", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
const rpc = opt("--rpc", RPCS[network]);
const noSign = args.includes("--no-sign");
const waitSecs = Number(opt("--wait", "60"));
const out = opt("--out");

function fail(msg, code = 2) { console.error(msg); process.exit(code); }
if (!txSig || !ref) fail("usage: node make-binding.mjs --tx <sig> --ref <purpose.ref> [--to wallet] [--network caip2] [--resource url] [--note text] [--label x] [--index n] [--out file] [--no-sign]");
if (!RPCS[network]) fail(`unsupported network ${network}`);

async function rpcCall(method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message} (code ${body.error.code})`);
    return body.result;
  }
  throw new Error(`${method}: RPC unavailable`);
}

// 1. The finalized transaction.
let tx = null;
const deadline = Date.now() + waitSecs * 1000;
for (;;) {
  tx = await rpcCall("getTransaction", [txSig, { commitment: "finalized", maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]);
  if (tx || Date.now() > deadline) break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (!tx) fail(`tx ${txSig} not finalized on ${network} after ${waitSecs}s`, 1);
if (tx.meta?.err !== null) fail(`tx failed on chain: ${JSON.stringify(tx.meta?.err)}`, 1);

// 2. The transfer and the memo.
const ixs = tx.transaction.message.instructions;
const isTc = (i) => TOKEN.includes(i.programId) && i.parsed?.type === "transferChecked";
let index;
if (opt("--index") !== undefined) {
  index = Number(opt("--index"));
  if (!ixs[index] || !isTc(ixs[index])) fail(`top-level ix ${index} is not a TransferChecked`, 1);
} else {
  const found = ixs.flatMap((i, n) => (isTc(i) ? [n] : []));
  if (found.length !== 1) fail(`expected exactly one top-level TransferChecked, found ${found.length}; pass --index`, 1);
  index = found[0];
}
const info = ixs[index].parsed.info;
if (!info.authority || info.multisigAuthority) fail("multisig authority is not supported", 1);
const memos = ixs.filter((i) => i.programId === MEMO);
if (memos.length !== 1 || typeof memos[0].parsed !== "string") fail(`expected exactly one top-level Memo, found ${memos.length}`, 1);
const memo = memos[0].parsed;
if (memo !== ref) console.error(`warning: Memo "${memo}" differs from --ref "${ref}" (expected only when the server sent no extra.memo)`);

const keys = tx.transaction.message.accountKeys;
const destIdx = keys.findIndex((k) => k.pubkey === info.destination);
const destOwner = tx.meta.postTokenBalances?.find((b) => b.accountIndex === destIdx)?.owner;
const to = opt("--to", destOwner);
if (!to) fail("could not determine payTo wallet; pass --to", 1);
if (destOwner && to !== destOwner) fail(`--to ${to} is not the owner of the destination token account (${destOwner})`, 1);

// 3. The record, in canonical key order.
const x402 = { nonce: memo, scheme: "exact" };
if (opt("--resource")) x402.resource = opt("--resource");
const purpose = { ref };
if (opt("--note")) purpose.note = opt("--note");
const record = JSON.parse(canonicalize({
  labels: all("--label"),
  payment: {
    amount: info.tokenAmount.amount,
    asset: info.mint,
    decimals: info.tokenAmount.decimals,
    from: info.authority,
    locator: { index, kind: "svm-top-level-ix", txVersion: tx.version === undefined ? "legacy" : tx.version },
    network,
    to,
    tx: txSig,
    x402,
  },
  purpose,
}));
if (JSON.stringify(record) !== canonicalize(record)) fail("internal: record is not in canonical order");
const content_sha256 = contentSha256(record);

// 4. The payer's signature.
let agent;
if (!noSign) {
  const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;
  if (!keyPath) fail("NIRIUM_PAYER_KEYPAIR (path to the payer keypair JSON) is required, or pass --no-sign");
  const bytes = Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")));
  if (bytes.length !== 64) fail("keypair file must hold 64 bytes (solana-keygen format)");
  const priv = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(bytes.slice(0, 32))]),
    format: "der", type: "pkcs8",
  });
  const pubRaw = Buffer.from(createPublicKey(priv).export({ format: "jwk" }).x, "base64url");
  const keyAddr = getAddressDecoder().decode(pubRaw);
  if (keyAddr !== info.authority) fail(`refusing to sign: key ${keyAddr} is not the transfer authority ${info.authority}`, 1);
  const statement = STATEMENT_PREFIX + content_sha256;
  agent = { alg: "ed25519-solana", key: keyAddr, signature: sign(null, Buffer.from(statement, "utf8"), priv).toString("base64"), statement };
}

const binding = { version: VERSION, content_sha256, record, ...(agent ? { agent } : {}), network };
const text = JSON.stringify(binding, null, 2) + "\n";
if (out) { writeFileSync(out, text); console.error(`wrote ${out} (index ${index}, tx v${record.payment.locator.txVersion}, signed=${!!agent})`); }
else process.stdout.write(text);
