// demo-pay.mjs - pays an x402 resource on Solana only if the rules policy says ALLOW.
//
// Usage:
//   NIRIUM_PAYER_KEYPAIR=<path> node demo-pay.mjs --url http://localhost:4021/paid --ref <order ref> \
//     --max 10000 [--approval-above 5000] [--allow-payto <base58>] [--network <caip2>] [--rpc <url>]
//
// Prints every decision the gate records (ALLOWED, SIGNED or the refusal) and, when paid, the
// settlement signature. On DENY or WAIT nothing is signed and nothing is sent to the seller.
// Mainnet needs NIRIUM_ALLOW_MAINNET=1. Only PayAI's published fee payers are allowed.

import { readFileSync, writeFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { createPolicyX402Fetch } from "./x402-fetch.mjs";
import { createRulesPolicy } from "./rules-policy.mjs";
import { X402PolicyError, KNOWN_ASSETS } from "./svm-policy.mjs";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const network = opt("--network", DEVNET);
const url = opt("--url");
const ref = opt("--ref");
const max = opt("--max");
const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;

if (!url || !ref || !max) { console.error("usage: node demo-pay.mjs --url <resource> --ref <order ref> --max <base units> [--approval-above n] [--allow-payto addr] [--network caip2] [--rpc url]"); process.exit(2); }
if (!KNOWN_ASSETS[network]) { console.error(`unsupported network ${network}`); process.exit(2); }
if (network === MAINNET && process.env.NIRIUM_ALLOW_MAINNET !== "1") { console.error("refusing to pay on mainnet without NIRIUM_ALLOW_MAINNET=1"); process.exit(2); }
if (!keyPath) { console.error("NIRIUM_PAYER_KEYPAIR (path to the payer keypair JSON) is required"); process.exit(2); }

const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const supported = await (await fetch("https://facilitator.payai.network/supported")).json();
const allowFeePayers = supported?.signers?.["solana:*"] ?? [];
const policy = createRulesPolicy({
  maxAmount: max,
  approvalAbove: opt("--approval-above"),
  allowPayTo: opt("--allow-payto") ? [opt("--allow-payto")] : undefined,
  allowAssets: Object.keys(KNOWN_ASSETS[network]),
  allowFeePayers,
  onDecision: (r) => {
    const a = r.context?.authorization;
    console.log(`policy ${r.outcome}${a ? `  amount=${a.amount} to=${a.to} feePayer=${a.feePayer.slice(0, 8)}...` : ""}${r.decision?.reason ? `  reason="${r.decision.reason}"` : ""}`);
  },
});

const pay = createPolicyX402Fetch({ signer, policy, network, rpcUrl: opt("--rpc") });
console.log(`payer=${signer.address} network=${network} url=${url} policy: max=${max}${opt("--approval-above") ? ` approvalAbove=${opt("--approval-above")}` : ""}`);
try {
  const res = await pay(url, { headers: { "X-Nirium-Ref": ref } });
  const header = res.headers.get("PAYMENT-RESPONSE");
  console.log(`HTTP ${res.status}`);
  if (!header) { console.error("no PAYMENT-RESPONSE header: nothing settled"); process.exit(1); }
  const settle = decodePaymentResponseHeader(header);
  if (!settle.success) { console.error(`settlement failed: ${settle.errorReason}`); process.exit(1); }
  writeFileSync("settle.json", JSON.stringify({ tx: settle.transaction, network, payer: signer.address, resource: url, ref }, null, 2));
  console.log(`tx: ${settle.transaction}`);
  console.log("wrote settle.json");
} catch (e) {
  if (e instanceof X402PolicyError) {
    console.log(`REFUSED by policy: ${e.outcome}. Nothing was signed and nothing was sent to the seller.`);
    process.exit(3);
  }
  throw e;
}
