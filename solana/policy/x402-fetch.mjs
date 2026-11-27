// fetch() that pays x402 `exact` on Solana only when the policy says ALLOW.
//
// One gated signer and one x402 client per call. The scheme is registered by hand with
// transactionVersions [0] (registerExactSvmScheme does not pass that config, and PayAI settles
// v0). The selected requirements are captured in onBeforePaymentCreation and handed to the gate.
// Only the `exact` scheme is registered, so `upto` and `batch-settlement` offers are never paid.
//
// NEVER register onPaymentCreationFailure here: it can return a payload that did not go through
// the signer, which would bypass the gate.

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createPolicyGatedSigner, X402PolicyError } from "./svm-policy.mjs";

/**
 * @param {object} cfg
 * @param {{address: string, signTransactions: Function}} cfg.signer  @solana/kit TransactionPartialSigner
 * @param {object} cfg.policy        X402PolicyHook (see svm-policy.mjs)
 * @param {string} cfg.network       "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" (devnet) or "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
 * @param {string} [cfg.rpcUrl]
 * @param {typeof fetch} [cfg.fetch]
 * @param {object} [cfg.gateOptions] { limits, assets } for describeAuthorization
 */
export function createPolicyX402Fetch(cfg) {
  const { signer, policy, network, rpcUrl, gateOptions } = cfg;
  const baseFetch = cfg.fetch ?? globalThis.fetch;
  if (!/^solana:[1-9A-HJ-NP-Za-km-z]{32}$/.test(String(network))) throw new Error("createPolicyX402Fetch: network must be solana:<genesis hash prefix>");

  return async function policyFetch(url, init) {
    const slot = { requirements: undefined, error: undefined };
    const method = String(init?.method ?? "GET").toUpperCase();
    const gated = createPolicyGatedSigner(
      signer, policy,
      () => ({ url: String(url), method, requirements: slot.requirements }),
      (err) => { slot.error = err; },
      gateOptions,
    );
    const client = new x402Client()
      .register(network, new ExactSvmScheme(gated, { transactionVersions: [0], ...(rpcUrl ? { rpcUrl } : {}) }))
      .onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
        slot.requirements = {
          scheme: r.scheme, network: r.network, asset: r.asset, payTo: r.payTo,
          amount: r.amount, maxTimeoutSeconds: r.maxTimeoutSeconds,
          extra: { feePayer: r.extra?.feePayer, memo: r.extra?.memo },
        };
      });
    try {
      return await wrapFetchWithPayment(baseFetch, client)(url, init);
    } catch (e) {
      if (slot.error instanceof X402PolicyError) throw slot.error;
      throw e;
    }
  };
}
