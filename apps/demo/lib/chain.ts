// What the chain alone shows about a Solana transaction: the token transfers in it (from, to,
// amount, mint), its slot and time, and any Memo. Read-only, straight from a public RPC in the
// visitor's browser. No receipt is made up here: a receipt is what adds who declared the payment
// and what it was for.

export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const NETWORKS: Record<string, { name: "devnet" | "mainnet"; rpc: string; usdc: string; cluster: string }> = {
  [DEVNET]: { name: "devnet", rpc: "https://api.devnet.solana.com", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", cluster: "?cluster=devnet" },
  // The public mainnet RPC answers 403 to any request that carries an Origin header, which every
  // browser sends. Mainnet therefore needs an RPC URL the visitor brings.
  [MAINNET]: { name: "mainnet", rpc: "https://api.mainnet-beta.solana.com", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", cluster: "" },
};

const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export const explorerTxUrl = (sig: string, network: string) =>
  `https://explorer.solana.com/tx/${encodeURIComponent(sig)}${NETWORKS[network]?.cluster ?? ""}`;

/** An RPC URL the visitor typed: https, or http on their own machine. */
export function cleanRpcUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return u.toString();
  } catch {}
  return null;
}

export type RpcFailure = "rate-limited" | "blocked" | "unreachable";
export class RpcError extends Error {
  kind: RpcFailure;
  constructor(kind: RpcFailure, message: string) { super(message); this.kind = kind; }
}

/** Maps a transport error (ours or the verifier's) to something a person can act on. */
export function rpcFailureOf(err: unknown): RpcFailure | null {
  if (err instanceof RpcError) return err.kind;
  const m = String((err as Error)?.message ?? err);
  if (/HTTP 429/.test(m)) return "rate-limited";
  if (/HTTP 40[13]|Access forbidden/.test(m)) return "blocked";
  if (/Failed to fetch|NetworkError|fetch failed|Load failed|HTTP 5\d\d/.test(m)) return "unreachable";
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON-RPC with growing waits on 429/5xx, so a busy public RPC is not reported as "not found". */
export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let status = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    } catch (e) {
      throw new RpcError("unreachable", String((e as Error).message));
    }
    status = res.status;
    if (status === 429 || status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    if (status === 401 || status === 403) throw new RpcError("blocked", `${method}: HTTP ${status}`);
    const body = await res.json();
    if (body.error) {
      if (body.error.code === 403) throw new RpcError("blocked", body.error.message);
      throw new Error(`${method}: ${body.error.message} (code ${body.error.code})`);
    }
    return body.result as T;
  }
  throw new RpcError(status === 429 ? "rate-limited" : "unreachable", `${method}: HTTP ${status}`);
}

export type Transfer = { index: string; from: string; to: string | null; amount: string; decimals: number | null; mint: string | null; usdc: boolean };
export type TxView = { network: string; signature: string; slot: number; blockTime: number | null; failed: boolean; transfers: Transfer[]; memos: string[] };

type ParsedIx = { programId: string; parsed?: unknown };
type Balance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { decimals: number } };
type RpcTx = any;

/** Pure: the token transfers and memos of a jsonParsed getTransaction result. */
export function readTransaction(tx: RpcTx, network: string, signature: string): TxView {
  const keys: string[] = tx.transaction.message.accountKeys.map((k: { pubkey: string } | string) => (typeof k === "string" ? k : k.pubkey));
  const balances: Balance[] = [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])];
  const balanceOf = (acct: string) => balances.find((b) => keys[b.accountIndex] === acct);
  const usdc = NETWORKS[network]?.usdc;

  const top: [string, ParsedIx][] = tx.transaction.message.instructions.map((ix: ParsedIx, i: number) => [String(i), ix]);
  const inner: [string, ParsedIx][] = (tx.meta?.innerInstructions ?? []).flatMap((g: { index: number; instructions: ParsedIx[] }) =>
    g.instructions.map((ix, j): [string, ParsedIx] => [`${g.index}.${j}`, ix]));

  const transfers: Transfer[] = [];
  const memos: string[] = [];
  for (const [index, ix] of [...top, ...inner]) {
    if (ix.programId === MEMO_PROGRAM && typeof ix.parsed === "string") { memos.push(ix.parsed); continue; }
    const p = ix.parsed as { type?: string; info?: Record<string, any> } | undefined;
    if (!TOKEN_PROGRAMS.includes(ix.programId) || !p?.info || (p.type !== "transfer" && p.type !== "transferChecked")) continue;
    const info = p.info;
    const dest = balanceOf(info.destination);
    const mint: string | null = info.mint ?? dest?.mint ?? balanceOf(info.source)?.mint ?? null;
    transfers.push({
      index,
      from: info.authority ?? info.multisigAuthority ?? balanceOf(info.source)?.owner ?? info.source,
      to: dest?.owner ?? null,
      amount: String(info.tokenAmount?.amount ?? info.amount),
      decimals: info.tokenAmount?.decimals ?? dest?.uiTokenAmount.decimals ?? null,
      mint,
      usdc: !!mint && mint === usdc,
    });
  }
  return { network, signature, slot: tx.slot, blockTime: tx.blockTime ?? null, failed: tx.meta?.err !== null, transfers, memos };
}

/** Looks a signature up on one network: finalized first, then confirmed. null = not there. */
export async function lookupTransaction(signature: string, network: string, rpcUrl: string): Promise<TxView | null> {
  for (const commitment of ["finalized", "confirmed"]) {
    const tx = await rpc<RpcTx>(rpcUrl, "getTransaction", [signature, { commitment, maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]);
    if (tx) return readTransaction(tx, network, signature);
  }
  return null;
}

/** "10000" with 6 decimals -> "0.01". */
export function formatUnits(amount: string, decimals: number | null): string {
  if (decimals === null || !/^\d+$/.test(amount)) return amount;
  const s = amount.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
