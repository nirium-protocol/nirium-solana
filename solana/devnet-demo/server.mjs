#!/usr/bin/env node
// server.mjs - reference x402 resource server on Solana devnet (exact scheme, PayAI).
// GET /paid costs 10000 base units of Circle devnet USDC (0.01 USDC).
//
// Deterministic memo: the resource server rebuilds the requirements when the
// paid retry arrives and checks `extra` as a subset of what the client accepted.
// A random memo per request would never match, so the memo comes from the
// client's X-Nirium-Ref header (which becomes purpose.ref in the binding).
// Without the header there is no extra.memo and the client puts its own random
// 32-hex nonce in the Memo instruction (default @x402/svm behavior).
//
// Env:
//   PAY_TO           payTo wallet (base58). Its USDC token account must already exist.
//   FACILITATOR_URL  default https://facilitator.payai.network
//   NETWORK          default solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 (devnet)
//   PORT             default 4021
//
// No keys here: the server never signs anything. The facilitator pays the fee.

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

const NETWORKS = {
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
const NETWORK = process.env.NETWORK || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const USDC = NETWORKS[NETWORK];
const PAY_TO = process.env.PAY_TO;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.payai.network";
const PORT = Number(process.env.PORT || 4021);
const AMOUNT = "10000";
const REF_RE = /^[A-Za-z0-9._:-]{1,128}$/;

if (!USDC) { console.error(`unsupported NETWORK ${NETWORK}`); process.exit(2); }
if (!PAY_TO) { console.error("PAY_TO is required (payTo wallet, base58)"); process.exit(2); }

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(NETWORK, new ExactSvmScheme());

const routes = {
  "GET /paid": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: PAY_TO,
      // DynamicPrice: same input (header) gives the same requirements on the retry.
      price: (ctx) => {
        const ref = ctx.adapter.getHeader("x-nirium-ref");
        const extra = ref && REF_RE.test(ref) ? { memo: ref } : undefined;
        return { asset: USDC, amount: AMOUNT, ...(extra ? { extra } : {}) };
      },
    },
    description: "Nirium devnet demo resource (0.01 USDC)",
    mimeType: "application/json",
  },
};

const app = express();

// Reject a malformed ref before the payment middleware, so it never becomes a memo.
app.use("/paid", (req, res, next) => {
  const ref = req.get("x-nirium-ref");
  if (ref !== undefined && !REF_RE.test(ref)) {
    return res.status(400).json({ error: "X-Nirium-Ref must match ^[A-Za-z0-9._:-]{1,128}$" });
  }
  next();
});

app.use(paymentMiddleware(routes, resourceServer));

app.get("/paid", (req, res) => {
  res.json({ ok: true, ref: req.get("x-nirium-ref") ?? null, network: NETWORK, note: "paid content" });
});

app.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}  network=${NETWORK}  payTo=${PAY_TO}  facilitator=${FACILITATOR_URL}`);
});
