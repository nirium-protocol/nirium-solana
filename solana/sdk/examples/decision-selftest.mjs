// decision-selftest.mjs - decision receipts on Solana devnet: a seller charging $0.01 with
// x402Serve, and a buyer whose pre-sign policy refuses it twice, once as DENY (limit $0.005) and
// once as WAIT (above $0.005 needs a person). Nothing is signed or sent, so nothing reaches the
// chain; the payer signs a decision receipt for each refusal, checked with verifyDecision. Team
// self-test with test tokens; never usage.
//
//   NIRIUM_PAYER_KEYPAIR=<path> PAY_TO=<wallet> node examples/decision-selftest.mjs --ref selftest-<date>-sol-decision [--out-dir dir]

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Serve, createX402Fetch, settlementOf, bindDecision, verifyDecision, collectDecisions, createRulesPolicy, DEVNET } from "../index.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const ref = arg("ref");
const outDir = arg("out-dir");
const keyPath = process.env.NIRIUM_PAYER_KEYPAIR;
const payTo = process.env.PAY_TO;
if (!ref || !keyPath || !payTo) { console.error("need --ref, NIRIUM_PAYER_KEYPAIR and PAY_TO"); process.exit(2); }

const app = express();
app.use(x402Serve({ payTo, network: DEVNET, routes: { "GET /data": { price: "$0.01", description: "Nirium decision selftest resource" } } }));
app.get("/data", (req, res) => res.json({ ok: true }));
const server = createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/data`;

const CASES = [
  { outcome: "DENY", rules: { maxAmount: "5000" }, note: "Refused before signing: $0.01 is above the $0.005 limit" },
  { outcome: "WAIT", rules: { maxAmount: "10000", approvalAbove: "5000" }, note: "Held before signing: above $0.005 needs a person's approval" },
];

let failed = 0;
try {
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
  const feePayers = (await (await fetch("https://facilitator.payai.network/supported")).json())?.signers?.["solana:*"] ?? [];
  for (const c of CASES) {
    const seen = collectDecisions();
    const pay = createX402Fetch({
      signer, network: DEVNET, maxAmountPerPayment: "10000",
      policy: createRulesPolicy({ ...c.rules, allowPayTo: [payTo], allowFeePayers: feePayers, onDecision: seen.onDecision }),
    });
    let res = null;
    try { res = await pay(url); } catch (e) { console.log(`${c.outcome}: payment refused (${e?.code ?? e?.name ?? "error"})`); }
    if (res && settlementOf(res)) { console.error(`${c.outcome}: a payment settled, this must not happen`); failed++; continue; }
    const rec = seen.records.find((r) => r.outcome === c.outcome);
    if (!rec) { console.error(`${c.outcome}: the policy did not return it (got ${seen.records.map((r) => r.outcome).join(",") || "nothing"})`); failed++; continue; }
    const { doc } = await bindDecision(rec, { signer, ref: `${ref}-${c.outcome.toLowerCase()}`, note: c.note, labels: ["selftest"] });
    const v = await verifyDecision(doc);
    console.log(`${c.outcome}: receipt ${v.ok ? "VALID" : "INVALID"} (${v.checks.filter((k) => k.ok).length}/${v.checks.length} checks), nothing signed on-chain`);
    if (!v.ok) failed++;
    if (outDir) { const f = `${outDir}/solana-devnet-decision-${c.outcome.toLowerCase()}.json`; writeFileSync(f, JSON.stringify(doc, null, 2) + "\n"); console.log(`wrote ${f}`); }
  }
} finally {
  server.close();
}
process.exitCode = failed ? 1 : 0;
