// selftest.mjs - the whole SDK in one run on Solana devnet: a seller charging with x402Serve, a
// buyer paying with createX402Fetch under a policy (only PayAI's published fee payers allowed), the
// order ref written on-chain as the Memo, a payer-signed receipt with bindReceipt, checked with
// verifyReceipt. Team self-test with test tokens; never usage.
//
//   NIRIUM_PAYER_KEYPAIR=<path> PAY_TO=<wallet> node examples/selftest.mjs --ref selftest-<date>-sol-sdk-01 [--out receipt.json]

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy, DEVNET } from "../index.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const ref = arg("ref");
const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;
const payTo = process.env.PAY_TO;
if (!ref || !keyPath || !payTo) { console.error("need --ref, NIRIUM_PAYER_KEYPAIR and PAY_TO"); process.exit(2); }

const app = express();
app.use(x402Serve({ payTo, network: DEVNET, routes: { "GET /data": { price: "$0.01", description: "Nirium SDK selftest resource" } } }));
app.get("/data", (req, res) => res.json({ ok: true, ref: req.get("x-nirium-ref"), at: new Date().toISOString() }));
const server = createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/data`;

try {
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
  const feePayers = (await (await fetch("https://facilitator.payai.network/supported")).json())?.signers?.["solana:*"] ?? [];
  const pay = createX402Fetch({
    signer, network: DEVNET, maxAmountPerPayment: "10000",
    policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: [payTo], allowFeePayers: feePayers, onDecision: (r) => console.log(`policy ${r.outcome}`) }),
  });
  const res = await pay(url, { headers: { "X-Nirium-Ref": ref } });
  const s = settlementOf(res);
  console.log(`HTTP ${res.status}  tx=${s?.transaction}`);
  if (!s) throw new Error("nothing settled");
  const receipt = await bindReceipt({ tx: s.transaction, network: DEVNET, ref, resource: url, note: "Nirium SDK selftest: x402Serve + createX402Fetch with policy", labels: ["selftest"], signer });
  const v = await verifyReceipt(receipt);
  console.log(`receipt ${v.ok ? "VALID" : "INVALID"} (${v.checks.filter((c) => c.ok).length}/${v.checks.length} checks), memo on-chain = "${receipt.record.payment.x402.nonce}"`);
  if (arg("out")) { writeFileSync(arg("out"), JSON.stringify(receipt, null, 2) + "\n"); console.log(`wrote ${arg("out")}`); }
  process.exitCode = v.ok ? 0 : 1;
} finally {
  server.close();
}
