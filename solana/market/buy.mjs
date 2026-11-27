// buy.mjs - buys one query from the market with the SDK (policy on, only PayAI's fee payers),
// prints the data, and writes the payer-signed receipt. Team self-test with test tokens.
//
//   NIRIUM_PAYER_KEYPAIR=<path> node buy.mjs --url http://localhost:4023/v1/market --payto <wallet> --ref <ref> [--out receipt.json]

import { readFileSync, writeFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy, DEVNET } from "nirium-solana";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://localhost:4023/v1/market");
const ref = arg("ref");
const payTo = arg("payto");
const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;
if (!ref || !payTo || !keyPath) { console.error("need --ref, --payto and NIRIUM_PAYER_KEYPAIR"); process.exit(2); }

const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const feePayers = (await (await fetch("https://facilitator.payai.network/supported")).json())?.signers?.["solana:*"] ?? [];
const pay = createX402Fetch({ signer, network: DEVNET, maxAmountPerPayment: "10000", policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo], allowFeePayers: feePayers, onDecision: (r) => console.log(`policy ${r.outcome}`) }) });
const res = await pay(url, { headers: { "X-Nirium-Ref": ref } });
const s = settlementOf(res);
const data = await res.json();
console.log(`HTTP ${res.status}  tx=${s?.transaction}`);
console.log(`market: slot ${data.slot}, priority fee p75 ${data.fees?.priorityFee?.p75}, non-vote TPS ${data.congestion?.nonVoteTps}, pressure ${data.feePressure}`);
if (!s) process.exit(1);
const receipt = await bindReceipt({ tx: s.transaction, network: DEVNET, ref, resource: url, note: "Nirium x402 market query (Solana network conditions)", labels: ["selftest"], signer });
const v = await verifyReceipt(receipt);
console.log(`receipt ${v.ok ? "VALID" : "INVALID"} (${v.checks.filter((c) => c.ok).length}/${v.checks.length}), memo on-chain "${receipt.record.payment.x402.nonce}"`);
if (arg("out")) writeFileSync(arg("out"), JSON.stringify(receipt, null, 2) + "\n");
process.exitCode = v.ok ? 0 : 1;
