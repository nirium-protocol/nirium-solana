// Runs the same verifier as `npx nirium-verify-svm` (nirium-solana/verify, the shared core) on a
// receipt the visitor pasted, and sorts the result for the page. Nothing leaves the browser except
// the RPC calls the verifier makes to the receipt's own network.

import { verifyBinding, type Check } from "nirium-solana/verify";
import { NETWORKS, MAINNET, SIGNATURE_RE, rpcFailureOf, type RpcFailure } from "./chain.ts";

export type Input =
  | { kind: "receipt"; doc: Record<string, any>; network: string }
  | { kind: "signature"; signature: string }
  | { kind: "invalid"; reason: "not-json" | "not-a-receipt" | "unknown-network" | "unrecognized" };

/** Decides what was pasted. The network comes from the receipt itself, never from the page. */
export function classify(text: string): Input {
  const t = text.trim();
  if (!t) return { kind: "invalid", reason: "unrecognized" };
  if (t.startsWith("{")) {
    let doc: any;
    try { doc = JSON.parse(t); } catch { return { kind: "invalid", reason: "not-json" }; }
    const network = doc?.record?.payment?.network;
    if (typeof network !== "string") return { kind: "invalid", reason: "not-a-receipt" };
    if (!NETWORKS[network]) return { kind: "invalid", reason: "unknown-network" };
    return { kind: "receipt", doc, network };
  }
  if (SIGNATURE_RE.test(t)) return { kind: "signature", signature: t };
  return { kind: "invalid", reason: "unrecognized" };
}

export type Verdict =
  | { status: "valid" | "invalid"; checks: Check[] }
  | { status: "incomplete"; checks: Check[]; failure: RpcFailure }
  | { status: "needs-rpc" }
  | { status: "rpc-error"; failure: RpcFailure }
  | { status: "bad-input"; message: string };

const TRANSPORT = /transport, not a verdict|RPC error HTTP|Failed to fetch/;

export async function verifyReceipt(doc: unknown, network: string, customRpc: string | null): Promise<Verdict> {
  if (network === MAINNET && !customRpc) return { status: "needs-rpc" };
  let res;
  try {
    res = await verifyBinding(doc, { rpc: customRpc ?? undefined });
  } catch (e) {
    const failure = rpcFailureOf(e);
    return failure ? { status: "rpc-error", failure } : { status: "bad-input", message: String((e as Error).message) };
  }
  // A check that failed because the RPC did not answer is not a verdict on the receipt.
  const transport = res.checks.find((c) => !c.ok && TRANSPORT.test(c.detail));
  if (transport) return { status: "incomplete", checks: res.checks, failure: rpcFailureOf(transport.detail) ?? "unreachable" };
  return { status: res.ok ? "valid" : "invalid", checks: res.checks };
}

/** Checks the chain answers, as opposed to checks of the receipt document on its own. */
export const isChainCheck = (name: string) =>
  /genesis|^tx |txVersion|^top-level ix|^ix |^transfer\.|single-key|authority signed|destination balance|Memo/.test(name);

/** Key for a plain-language reason (see i18n.ts), when a check has one. */
export function reasonKey(name: string): string | null {
  if (name.startsWith("content_sha256")) return "hash";
  if (name.startsWith("agent.statement")) return "statement";
  if (name.startsWith("ed25519 signature")) return "signature";
  if (name.startsWith("agent.key")) return "signer";
  if (name.startsWith("agent block")) return "unsigned";
  if (name === "transfer.amount == payment.amount" || name.startsWith("destination balance")) return "amount";
  if (name.startsWith("transfer.destination")) return "destination";
  if (name.startsWith("transfer.authority")) return "authority";
  if (name.startsWith("Memo text")) return "memo";
  if (name.startsWith("tx found")) return "tx";
  if (/^(top-level ix|ix )/.test(name)) return "index";
  return null;
}
