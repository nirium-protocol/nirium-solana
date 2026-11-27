// Runs the same verifier as `npx nirium-verify-svm` (nirium-solana/verify, the shared core) on a
// receipt the visitor pasted, and sorts the result for the page. Nothing leaves the browser except
// the RPC calls the verifier makes to the receipt's own network.

import { verifyBinding, contentSha256, ed25519Valid, STATEMENT_PREFIX, VERSION, type Check } from "nirium-solana/verify";
import { extractCid } from "./ipfs.ts";
import { NETWORKS, MAINNET, SIGNATURE_RE, rpcFailureOf, type RpcFailure } from "./chain.ts";

export type Input =
  | { kind: "receipt"; doc: Record<string, any>; network: string }
  | { kind: "signature"; signature: string }
  | { kind: "cid"; cid: string }
  | { kind: "foreign"; family: "stellar" | "evm" }
  | { kind: "invalid"; reason: "not-json" | "not-a-receipt" | "unknown-network" | "unrecognized" };

/** Decides what was pasted: a CID (or gateway URL), a transaction signature, or a receipt. The
 *  network comes from the receipt itself, never from the page. */
export function classify(text: string): Input {
  const t = text.trim();
  if (!t) return { kind: "invalid", reason: "unrecognized" };
  if (t.startsWith("{")) {
    let doc: any;
    try { doc = JSON.parse(t); } catch { return { kind: "invalid", reason: "not-json" }; }
    return classifyDoc(doc);
  }
  const cid = extractCid(t);
  if (cid) return { kind: "cid", cid };
  if (SIGNATURE_RE.test(t)) return { kind: "signature", signature: t };
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return { kind: "foreign", family: "evm" };
  return { kind: "invalid", reason: "unrecognized" };
}

/** A parsed document: a receipt for this page's networks, one for another network, or neither. */
export function classifyDoc(doc: any): Input {
  const network = doc?.record?.payment?.network ?? doc?.network;
  if (typeof network === "string" && network.startsWith("stellar:")) return { kind: "foreign", family: "stellar" };
  if (typeof network === "string" && network.startsWith("eip155:")) return { kind: "foreign", family: "evm" };
  if (typeof doc?.record?.payment?.network !== "string") return { kind: "invalid", reason: "not-a-receipt" };
  if (!NETWORKS[network]) return { kind: "invalid", reason: "unknown-network" };
  return { kind: "receipt", doc, network };
}

/** Where a receipt or transaction of another network can be checked. */
export const FOREIGN_URL = { stellar: "https://nirium.xyz/verify", evm: "https://avalanche.nirium.xyz/explorer" } as const;

/**
 * What can be checked without the chain: the hash of the record, the statement, who signed and
 * the signature. Used when a mainnet receipt has no RPC to ask; never reported as VALID.
 */
export function checkOffline(doc: any): Check[] {
  const p = doc?.record?.payment ?? {};
  const a = doc?.agent ?? {};
  const computed = contentSha256(doc?.record);
  let sigOk = false;
  try { sigOk = typeof a.key === "string" && typeof a.signature === "string" && ed25519Valid(a.key, String(a.statement), a.signature); } catch { sigOk = false; }
  return [
    { name: "version == nirium-payment-binding-v1", ok: doc?.version === VERSION, detail: `version=${doc?.version}` },
    { name: "content_sha256 == sha256(canonical(record))", ok: doc?.content_sha256 === computed, detail: `doc=${doc?.content_sha256} computed=${computed}` },
    { name: "agent.statement == nirium-audit-v1:<content_sha256>", ok: a.statement === STATEMENT_PREFIX + doc?.content_sha256, detail: `statement=${a.statement}` },
    { name: "agent.key == payment.from (payer signs)", ok: !!a.key && a.key === p.from, detail: `key=${a.key}` },
    { name: "ed25519 signature by agent.key over agent.statement", ok: sigOk, detail: "" },
  ];
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
