// x402Serve(): charge for your own API on Solana in three lines, same shape as the Stellar one in
// the `nirium` package:
//
//   app.use(x402Serve({ payTo: "<wallet>", routes: { "GET /signals": "$0.02" } }));
//
// Runs on YOUR server. Nirium runs nothing here and receives nothing: the buyer pays your payTo
// directly and an independent facilitator (PayAI by default) verifies, pays the network fee and
// settles. No telemetry.
//
// The order reference travels in the X-Nirium-Ref request header and becomes the on-chain Memo
// (extra.memo). It must be deterministic: on the paid retry the server rebuilds the requirements
// and compares them, so a random memo per request would never match. Malformed refs get 400.
// Before the first paid request the middleware checks the facilitator supports the network and
// that payTo already has its USDC token account (PayAI refuses to pay into a missing one); if not,
// paid routes answer 503 with a hint and every other route keeps working.

import { address as toAddress } from "@solana/kit";
import { associatedTokenAddress } from "nirium-solana-policy";
import { getNetwork, dollarsToAtomic, rpcCall, PAYAI_FACILITATOR, REF_RE, TOKEN_PROGRAM } from "./networks.mjs";

/**
 * @param {object} config
 * @param {string} config.payTo  wallet that receives the USDC (its USDC token account must exist)
 * @param {Record<string, string | {price?: string, amount?: string, description?: string}>} config.routes
 * @param {string} [config.network]         default devnet
 * @param {string} [config.facilitatorUrl]  default PayAI
 * @param {string} [config.rpcUrl]          used for the payTo token-account preflight
 * @param {number} [config.maxTimeoutSeconds] default 120
 */
export function x402Serve(config) {
  let payTo;
  try { payTo = String(toAddress(String(config?.payTo ?? ""))); } catch { throw new Error("x402Serve: `payTo` must be a Solana address. Without it there is nobody to pay."); }
  const entries = Object.entries(config.routes || {});
  if (entries.length === 0) throw new Error("x402Serve: `routes` is empty; nothing would ever be charged for.");
  const network = config.network || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  const net = getNetwork(network);
  const facilitatorUrl = (config.facilitatorUrl || PAYAI_FACILITATOR).replace(/\/+$/, "");
  const rpcUrl = config.rpcUrl || net.rpc;

  const routes = {};
  const paid = [];
  for (const [key, value] of entries) {
    const spec = typeof value === "string" ? { price: value } : value;
    const amount = spec.amount !== undefined ? String(spec.amount) : dollarsToAtomic(spec.price);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error(`x402Serve: route "${key}" needs a positive amount`);
    const routeKey = /^[A-Z]+\s/.test(key) ? key : `GET ${key}`;
    const [method, path] = routeKey.split(/\s+/, 2);
    paid.push({ method: method.toUpperCase(), path, prefix: path.endsWith("/*") ? path.slice(0, -1) : undefined });
    routes[routeKey] = {
      ...(spec.description ? { description: spec.description } : {}),
      accepts: {
        scheme: "exact", network, payTo,
        maxTimeoutSeconds: config.maxTimeoutSeconds ?? 120,
        // DynamicPrice: the same header gives the same requirements on the paid retry.
        price: (ctx) => {
          const ref = ctx.adapter.getHeader("x-nirium-ref");
          return { asset: net.usdc, amount, ...(ref && REF_RE.test(ref) ? { extra: { memo: ref } } : {}) };
        },
      },
    };
  }

  const preflight = async () => {
    const r = await fetch(`${facilitatorUrl}/supported`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`facilitator returned ${r.status}`);
    const body = await r.json();
    if (!(body?.kinds ?? []).some((k) => k.network === network && k.scheme === "exact")) throw new Error(`facilitator does not support exact on ${network}`);
    const ata = await associatedTokenAddress(payTo, net.usdc, TOKEN_PROGRAM);
    const acct = await rpcCall(rpcUrl, "getAccountInfo", [String(ata), { encoding: "base64" }]);
    if (!acct?.value) throw new Error(`payTo ${payTo} has no USDC token account (${ata}); create it before charging`);
  };

  let cached;
  const build = async () => {
    await preflight();
    const [{ paymentMiddleware, x402ResourceServer }, { HTTPFacilitatorClient }, { ExactSvmScheme }] = await Promise.all([
      import("@x402/express"), import("@x402/core/server"), import("@x402/svm/exact/server"),
    ]);
    const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(network, new ExactSvmScheme());
    return paymentMiddleware(routes, server);
  };

  const isPaid = (req) => {
    const path = String(req.path ?? req.url ?? "").split("?")[0];
    return paid.some((r) => r.method === String(req.method).toUpperCase() && (r.prefix ? path.startsWith(r.prefix) : path === r.path));
  };

  return async function niriumX402(req, res, next) {
    if (!isPaid(req)) return next();
    const ref = req.headers?.["x-nirium-ref"];
    if (ref !== undefined && !REF_RE.test(String(ref))) return res.status(400).json({ error: "X-Nirium-Ref must match ^[A-Za-z0-9._:-]{1,128}$" });
    try {
      if (!cached) cached = build().catch((e) => { cached = undefined; throw e; });
      const mw = await cached;
      return mw(req, res, next);
    } catch (err) {
      if (res.headersSent) return;
      const detail = String(err?.message ?? err).slice(0, 200);
      res.status(503).json({
        error: "x402 payments unavailable", detail,
        hint: /token account/.test(detail) ? "create the payTo's USDC token account first" : "the facilitator could not be reached or does not support this network",
      });
    }
  };
}
