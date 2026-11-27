// The result as a drawing of the mechanism: what the receipt declares on one side, what the chain
// shows on the other, and one link per thing that must match, each decided by the verifier's own
// checks (never by this file). Also the edits a visitor can make to a real receipt to watch a link
// break, re-checked with the same verifier.
import type { Check } from "nirium-solana/verify";
import { formatUnits, type TxView } from "./chain.ts";

export type LinkKey = "content" | "payer" | "amount" | "destination" | "reference" | "where";
export type Link = { key: LinkKey; receipt: string; chain: string | null; ok: boolean; failed: string | null };

/** Which verifier checks decide each link. A link passes only if all of its checks ran and passed. */
const DECIDED_BY: Record<LinkKey, RegExp> = {
  content: /^content_sha256 |^agent\.statement /,
  payer: /^agent\.key |^ed25519 signature|^transfer\.authority |^authority signed|^single-key/,
  amount: /^transfer\.amount |^destination balance delta|^transfer\.mint |^transfer\.decimals /,
  destination: /^transfer\.destination /,
  reference: /Memo/,
  where: /^network == solana:|^tx found|^tx meta\.err|^locator\.txVersion|^ix \d+ |^top-level ix/,
};

const short = (s: string) => (s && s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);

export function links(doc: any, tx: TxView | null, checks: Check[]): Link[] {
  const p = doc.record.payment;
  const x = tx?.transfers.find((t) => t.index === String(p.locator?.index)) ?? null;
  const usdc = (a: string) => `${formatUnits(a, p.decimals ?? 6)} USDC`;
  const pick = (key: LinkKey) => {
    const mine = checks.filter((c) => DECIDED_BY[key].test(c.name));
    const bad = mine.find((c) => !c.ok);
    return { ok: mine.length > 0 && !bad, failed: bad?.name ?? (mine.length ? null : "not checked") };
  };
  return [
    // The content link is not on chain: its right side is the hash this browser computed.
    { key: "content", receipt: short(doc.content_sha256), chain: short(checks.find((c) => c.name.startsWith("content_sha256"))?.detail.match(/computed=(\w+)/)?.[1] ?? ""), ...pick("content") },
    { key: "payer", receipt: short(doc.agent?.key ?? p.from), chain: x ? short(x.from) : null, ...pick("payer") },
    { key: "amount", receipt: usdc(p.amount), chain: x ? usdc(x.amount) : null, ...pick("amount") },
    { key: "destination", receipt: short(p.to), chain: x?.to ? short(x.to) : null, ...pick("destination") },
    { key: "reference", receipt: p.x402?.nonce ?? "", chain: tx?.memos.length ? tx.memos.join(", ") : null, ...pick("reference") },
    { key: "where", receipt: short(p.tx), chain: tx ? `slot ${tx.slot}` : null, ...pick("where") },
  ];
}

export type Edit = "amount" | "destination" | "purpose";

/** A copy of the receipt with one field changed after it was signed. */
export function edit(doc: any, what: Edit): any {
  const d = structuredClone(doc);
  const p = d.record.payment;
  if (what === "amount") p.amount = String(BigInt(p.amount) * 10n);
  // Paid to someone else: here, the payer's own address.
  if (what === "destination") p.to = p.from;
  if (what === "purpose") d.record.purpose = { ...(d.record.purpose ?? {}), note: "Edited after it was signed" };
  return d;
}

/**
 * A fetch that answers repeated identical RPC calls from memory, so the edits re-run the real
 * verifier against the chain answers already read, without asking the RPC again.
 */
export function cachingFetch(base: typeof fetch = fetch): typeof fetch {
  const seen = new Map<string, Promise<{ status: number; body: string }>>();
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${String(url)} ${init?.body ?? ""}`;
    if (!seen.has(key)) {
      const pending = base(url, init).then(async (r) => ({ status: r.status, body: await r.text() }));
      seen.set(key, pending);
      pending.then((r) => { if (r.status !== 200) seen.delete(key); }, () => seen.delete(key));
    }
    const r = await seen.get(key)!;
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** Runs `fn` with `f` as the global fetch (the shared verifier calls fetch directly), then restores it. */
export async function withFetch<T>(f: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
