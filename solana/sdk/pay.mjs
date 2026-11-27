// createX402Fetch(): pay x402 resources on Solana with a per-payment cap and, optionally, the
// pre-sign policy (a payment the policy refuses is never signed). Same idea as initX402 +
// x402Fetch in the `nirium` package.
//
//   const pay = createX402Fetch({ signer, maxAmountPerPayment: "10000", policy });
//   const res = await pay("https://seller.example/paid", { headers: { "X-Nirium-Ref": "order-42" } });
//   const settlement = settlementOf(res);   // { transaction, network, payer } or undefined
//
// The scheme is registered by hand with transactionVersions [0] (PayAI settles v0, and the
// registerExactSvmScheme helper ignores that option). Only `exact` is registered.

import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createPolicyX402Fetch } from "../policy/x402-fetch.mjs";
import { getNetwork } from "./networks.mjs";

/**
 * @param {object} cfg
 * @param {{address: string, signTransactions: Function}} cfg.signer  the payer's @solana/kit TransactionPartialSigner
 * @param {string} [cfg.network]  default devnet
 * @param {string} cfg.maxAmountPerPayment  cap in atomic USDC; refuses anything above before signing
 * @param {object} [cfg.policy]   X402PolicyHook; when set, nothing is signed without its ALLOW
 * @param {string} [cfg.rpcUrl]
 * @param {boolean} [cfg.allowMainnet]  must be true to pay on mainnet
 * @param {typeof fetch} [cfg.fetch]
 */
export function createX402Fetch(cfg) {
  const network = cfg.network || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  const net = getNetwork(network);
  if (net.mainnet && cfg.allowMainnet !== true) throw new Error("createX402Fetch: refusing mainnet without allowMainnet: true (real funds)");
  if (!/^\d+$/.test(String(cfg.maxAmountPerPayment ?? ""))) throw new Error("createX402Fetch: maxAmountPerPayment (atomic USDC) is required");
  const max = BigInt(cfg.maxAmountPerPayment);
  if (cfg.policy) {
    // The cap still applies: a policy that would ALLOW above it is not asked.
    const capped = {
      ...cfg.policy,
      evaluate: async (ctx, opts) => (BigInt(ctx.authorization.amount) > max
        ? { decision: "DENY", reason: `amount ${ctx.authorization.amount} above maxAmountPerPayment ${max}` }
        : cfg.policy.evaluate(ctx, opts)),
    };
    return createPolicyX402Fetch({ signer: cfg.signer, policy: capped, network, rpcUrl: cfg.rpcUrl, fetch: cfg.fetch });
  }
  const client = new x402Client().register(network, new ExactSvmScheme(cfg.signer, { transactionVersions: [0], ...(cfg.rpcUrl ? { rpcUrl: cfg.rpcUrl } : {}) }));
  client.setSpendControls({ allowedAssets: [{ network, asset: net.usdc, maxAmountPerPayment: String(max) }] });
  return wrapFetchWithPayment(cfg.fetch ?? globalThis.fetch, client);
}

/** Reads the settlement from a paid response, or undefined if nothing was settled. */
export function settlementOf(response) {
  const h = response?.headers?.get?.("PAYMENT-RESPONSE");
  if (!h) return undefined;
  const s = decodePaymentResponseHeader(h);
  return s?.success ? s : undefined;
}
