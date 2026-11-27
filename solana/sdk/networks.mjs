// Solana networks Nirium supports. USDC mints are the ones @x402/svm 2.32.0 uses by default
// (USDC_DEVNET_ADDRESS / USDC_MAINNET_ADDRESS), both classic SPL Token, 6 decimals.
export const NETWORKS = Object.freeze({
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { name: "devnet", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", rpc: "https://api.devnet.solana.com", explorerCluster: "?cluster=devnet", mainnet: false },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { name: "mainnet", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", rpc: "https://api.mainnet-beta.solana.com", explorerCluster: "", mainnet: true },
});
export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const USDC_DECIMALS = 6;
/** Independent x402 facilitator used by default. Nirium does not run one. */
export const PAYAI_FACILITATOR = "https://facilitator.payai.network";
/** Order references become the on-chain Memo, so they are kept short and plain. */
export const REF_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function getNetwork(id) {
  const n = NETWORKS[id];
  if (!n) throw new Error(`unsupported network ${id}; use one of ${Object.keys(NETWORKS).join(", ")}`);
  return n;
}

/** "$0.01" or "0.01" -> atomic USDC units as a string. Rejects more than 6 decimals. */
export function dollarsToAtomic(price) {
  const m = /^\$?(\d+)(?:\.(\d{1,6}))?$/.exec(String(price).trim());
  if (!m) throw new Error(`price "${price}" must look like "$0.01" (at most 6 decimals)`);
  const atomic = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  if (atomic <= 0n) throw new Error(`price "${price}" must be above zero`);
  return atomic.toString();
}

/** JSON-RPC call with retries on 429/5xx (public RPCs rate-limit). */
export async function rpcCall(url, method, params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message} (code ${body.error.code})`);
    return body.result;
  }
  throw new Error(`${method}: RPC unavailable`);
}
