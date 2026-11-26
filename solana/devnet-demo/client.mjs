#!/usr/bin/env node
// client.mjs - reference x402 payer on Solana (exact scheme). PAYS REAL TOKENS on
// whatever network the server asks for, so it only accepts the network it is told
// to accept and an amount cap.
//
// Usage:
//   NIRIUM_PAYER_KEYPAIR=<path to solana-keygen JSON> \
//   node client.mjs --url http://localhost:4021/paid --ref selftest-2026-11-26-sol-devnet-01 \
//     [--network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1] [--rpc <url>] [--max 10000]
//
// Mainnet (solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp) also needs NIRIUM_ALLOW_MAINNET=1:
// that is a real payment from the operator's own wallet, a labeled self-test.
//
// Notes read in @x402/svm 2.32.0:
// - ExactSvmScheme is registered by hand: registerExactSvmScheme() takes no
//   ClientSvmConfig, so it cannot pin transactionVersions. With the default [0, 1]
//   and PayAI advertising [0, 1] the client would build a v1 tx.
// - The tx signature comes back in the PAYMENT-RESPONSE header (field `transaction`).
// The key file is read, never printed or copied.

import { readFileSync } from "node:fs";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const USDC = {
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt("--url");
const ref = opt("--ref");
const network = opt("--network", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
const rpcUrl = opt("--rpc");
const max = BigInt(opt("--max", "10000"));

if (!url || !ref) { console.error("usage: node client.mjs --url <resource> --ref <purpose.ref> [--network caip2] [--rpc url] [--max units]"); process.exit(2); }
if (!USDC[network]) { console.error(`unsupported network ${network}`); process.exit(2); }
if (network === MAINNET && process.env.NIRIUM_ALLOW_MAINNET !== "1") {
  console.error("mainnet payment refused: set NIRIUM_ALLOW_MAINNET=1 (real funds, operator self-test only)");
  process.exit(2);
}
const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;
if (!keyPath) { console.error("NIRIUM_PAYER_KEYPAIR (path to the payer keypair JSON) is required"); process.exit(2); }

const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));

const client = new x402Client()
  .register(network, new ExactSvmScheme(signer, { transactionVersions: [0], ...(rpcUrl ? { rpcUrl } : {}) }))
  // Only pay the expected network, scheme, asset and memo, and never above the cap.
  .registerPolicy((_version, reqs) => reqs.filter((r) =>
    r.scheme === "exact"
    && r.network === network
    && r.asset === USDC[network]
    && BigInt(r.amount) <= max
    && r.extra?.memo === ref));

const fetchWithPay = wrapFetchWithPayment(fetch, client);
console.log(`payer=${signer.address} network=${network} max=${max} ref=${ref}`);
const res = await fetchWithPay(url, { headers: { "X-Nirium-Ref": ref } });
const body = await res.text();
console.log(`HTTP ${res.status}`);
console.log(body);

const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
if (!header) { console.error("no PAYMENT-RESPONSE header: nothing was settled"); process.exit(1); }
const settle = decodePaymentResponseHeader(header);
console.log(JSON.stringify({ success: settle.success, network: settle.network, payer: settle.payer, transaction: settle.transaction }, null, 2));
if (!settle.success || !settle.transaction) process.exit(1);
console.log(`\nnext: node make-binding.mjs --tx ${settle.transaction} --network ${network} --ref ${ref} --resource ${url} --label selftest`);
