// Fetches a receipt by its CID straight from public IPFS gateways, in the visitor's browser, and
// recomputes the CID from the bytes that came back. Nothing goes through a Nirium server. A gateway
// that serves bytes whose CID is not the one asked for is caught here, never shown as a receipt.
// The CIDv0 algorithm is the one nirium.xyz/verify uses (apps/web/lib/receiptCid.ts in
// nirium-core-private): one dag-pb block wrapping a UnixFS file. CIDv1 (base32, "b…") is also
// recomputed, for dag-pb and raw blocks.

export const GATEWAYS = [
  "https://nirium.myfilebase.com",
  "https://gateway.pinata.cloud",
  "https://ipfs.io",
  "https://dweb.link",
] as const;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export const BLOCK_BYTES = 262144;

/** A CID from a bare CID, ipfs://, …/ipfs/<cid>, or https://<cid>.ipfs.<gateway>/. */
export function extractCid(input: string): string | null {
  const t = input.trim();
  const m = t.match(/^ipfs:\/\/([^/?#]+)/i) ?? t.match(/^https?:\/\/([a-z0-9]+)\.ipfs\.[^/]+/i) ?? t.match(/\/ipfs\/([^/?#]+)/) ?? [null, t];
  const cid = (m[1] ?? "").replace(/\/+$/, "");
  return /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{50,}$/.test(cid) ? cid : null;
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const varint = (n: number) => {
  const out: number[] = [];
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return Uint8Array.from(out);
};
const field = (tag: number, b: Uint8Array) => concat([Uint8Array.of(tag), varint(b.length), b]);
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function base58(b: Uint8Array): string {
  let n = BigInt("0x" + (hex(b) || "0"));
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of b) { if (x !== 0) break; out = "1" + out; }
  return out;
}
export function base32(b: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const x of b) {
    value = (value << 8) | x; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string): Uint8Array | null {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

/** The dag-pb node `ipfs add` makes for a file that fits in one block. */
const unixfsNode = (bytes: Uint8Array) =>
  field(0x0a, concat([Uint8Array.of(0x08, 0x02), field(0x12, bytes), Uint8Array.of(0x18), varint(bytes.length)]));

/**
 * Does `bytes` hash to `cid`? true / false, or null when it can't be decided here (more than one
 * block, or a CID kind this page does not handle); then `npx nirium-cli verify <CID>` decides.
 */
export async function cidMatches(cid: string, bytes: Uint8Array): Promise<boolean | null> {
  if (bytes.length === 0 || bytes.length > BLOCK_BYTES) return null;
  if (cid.startsWith("Qm")) return base58(concat([Uint8Array.of(0x12, 0x20), await sha256(unixfsNode(bytes))])) === cid;
  const raw = unbase32(cid.slice(1));
  // CIDv1: version 1, codec dag-pb (0x70) or raw (0x55), multihash sha2-256 (0x12, 32 bytes).
  if (!raw || raw.length !== 36 || raw[0] !== 0x01 || raw[2] !== 0x12 || raw[3] !== 0x20) return null;
  const digest = raw[1] === 0x70 ? await sha256(unixfsNode(bytes)) : raw[1] === 0x55 ? await sha256(bytes) : null;
  return digest ? hex(digest) === hex(raw.slice(4)) : null;
}

export type Attempt = { gateway: string; status: number | "timeout" | "error" };
export type Fetched =
  | { status: "ok"; gateway: string; bytes: Uint8Array; cidCheck: boolean | null; attempts: Attempt[] }
  | { status: "mismatch"; gateway: string; attempts: Attempt[] }
  | { status: "not-found"; attempts: Attempt[] };

/**
 * Tries each gateway in order and moves on when one fails, times out or rate-limits (429). The
 * first one that answers decides: if its bytes do not hash to the CID, the result is a mismatch
 * naming that gateway, not a receipt.
 */
export async function fetchCid(cid: string, opts: { gateways?: readonly string[]; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<Fetched> {
  const { gateways = GATEWAYS, timeoutMs = 15000, fetchImpl = fetch } = opts;
  const attempts: Attempt[] = [];
  for (const gateway of gateways) {
    let res: Response;
    try {
      res = await fetchImpl(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(timeoutMs), credentials: "omit", referrerPolicy: "no-referrer" });
    } catch (e) {
      attempts.push({ gateway, status: (e as Error)?.name === "TimeoutError" ? "timeout" : "error" });
      continue;
    }
    attempts.push({ gateway, status: res.status });
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const cidCheck = await cidMatches(cid, bytes);
    if (cidCheck === false) return { status: "mismatch", gateway, attempts };
    return { status: "ok", gateway, bytes, cidCheck, attempts };
  }
  return { status: "not-found", attempts };
}
