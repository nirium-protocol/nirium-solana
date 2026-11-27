#!/usr/bin/env node
// make-binding.mjs - builds a "nirium-payment-binding-v1" document for a settled x402 exact
// payment on Solana and signs it with the payer's key. Thin CLI over bindReceipt() in ../sdk
// (the logic lives there, once).
//
// Usage:
//   NIRIUM_PAYER_KEYPAIR=<path to solana-keygen JSON> \
//   node make-binding.mjs --tx <signature> --ref <purpose.ref> [--to <payTo wallet>]
//     [--network <caip2>] [--rpc <url>] [--resource <url>] [--note <text>]
//     [--label selftest] [--index <n>] [--out binding.json] [--no-sign] [--wait 60]
//
// Refuses to sign if the key is not the transfer authority. The key is never printed.
// --no-sign writes the document without the agent block (for verify-svm-receipt.mjs --no-sig).

import { readFileSync, writeFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { bindReceipt } from "../sdk/receipt.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };

const tx = opt("--tx");
const ref = opt("--ref");
if (!tx || !ref) fail("usage: node make-binding.mjs --tx <sig> --ref <purpose.ref> [--to wallet] [--network caip2] [--resource url] [--note text] [--label x] [--index n] [--out file] [--no-sign]");

let signer;
if (!args.includes("--no-sign")) {
  const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;
  if (!keyPath) fail("NIRIUM_PAYER_KEYPAIR (path to the payer keypair JSON) is required, or pass --no-sign");
  const bytes = Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8")));
  if (bytes.length !== 64) fail("keypair file must hold 64 bytes (solana-keygen format)");
  signer = await createKeyPairSignerFromBytes(bytes);
}

let binding;
try {
  binding = await bindReceipt({
    tx, ref, signer,
    network: opt("--network", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
    rpcUrl: opt("--rpc"), resource: opt("--resource"), note: opt("--note"), labels: all("--label"),
    to: opt("--to"), index: opt("--index") !== undefined ? Number(opt("--index")) : undefined,
    waitMs: Number(opt("--wait", "60")) * 1000,
  });
} catch (e) { fail(e.message, 1); }

const text = JSON.stringify(binding, null, 2) + "\n";
const out = opt("--out");
const loc = binding.record.payment.locator;
if (out) { writeFileSync(out, text); console.error(`wrote ${out} (index ${loc.index}, tx v${loc.txVersion}, signed=${!!binding.agent})`); }
else process.stdout.write(text);
