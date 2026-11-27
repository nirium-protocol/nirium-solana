// verify-svm-core.mjs - read-only check of a Nirium payment binding on Solana.
//
// The one verifier: the CLI (verify-svm-receipt.mjs), verifyReceipt() and the browser all run
// this file. It has no Node-only imports (no node:crypto, no Buffer, no fs), so it also runs in
// a browser: sha256 and ed25519 come from @noble/hashes and @noble/curves, base64 from atob/btoa.
//
// Format "nirium-payment-binding-v1" (fixed 26-nov-2026, the same format on every chain):
// {
//   "version": "nirium-payment-binding-v1",
//   "content_sha256": "<hex sha256 of canonical(record)>",
//   "record": {
//     "labels": ["selftest"],
//     "payment": {
//       "amount": "10000", "asset": "<mint>", "decimals": 6,
//       "from": "<payer wallet = transfer authority>", "to": "<payTo wallet>",
//       "tx": "<base58 tx signature>",
//       "locator": { "index": 2, "kind": "svm-top-level-ix", "txVersion": 0 },
//       "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
//       "x402": { "nonce": "<Memo text>", "resource": "https://...", "scheme": "exact" }
//     },
//     "purpose": { "note": "...", "ref": "..." }
//   },
//   "agent": { "alg": "ed25519-solana", "key": "<payer base58>",
//              "signature": "<base64>", "statement": "nirium-audit-v1:<content_sha256>" },
//   "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
// }
//
// canonical() = keys sorted recursively, no whitespace, values as JSON.stringify
// writes them; applied ONLY to `record`.
// --no-sig skips the `agent` block (for third-party txs we did not sign); the
// record hash and every on-chain check still run.
//
// Scope of this version: scheme "exact" only, top-level TransferChecked only
// (a transfer that only exists as an inner/CPI instruction fails), single-key
// authority only (multisig authority fails), Circle USDC only.
// Not checked here: that no other binding claims the same (network, tx, index);
// that is the aggregator's job (node or registry).
//
// No keys, no writes: only getGenesisHash and getTransaction.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

export const VERSION = "nirium-payment-binding-v1";
export const STATEMENT_PREFIX = "nirium-audit-v1:";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

// Same mints as DEFAULT_ASSETS in @x402/svm 2.32.0.
const NETWORKS = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": {
    rpc: "https://api.mainnet-beta.solana.com",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": {
    rpc: "https://api.devnet.solana.com",
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
};

export function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  return "{" + Object.keys(v).sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
}

export function contentSha256(record) {
  return bytesToHex(sha256(utf8ToBytes(canonicalize(record))));
}

// Standard base64 (with or without padding), the encoding receipts use for agent.signature.
// atob and btoa exist in browsers and in Node 16+.
export function base64ToBytes(s) {
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function ata(owner, mint, tokenProgram) {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [enc.encode(address(owner)), enc.encode(address(tokenProgram)), enc.encode(address(mint))],
  });
  return pda;
}

// Raw ed25519 over the UTF-8 bytes of `message`, no prefix. zip215: false is the strict
// RFC 8032 rule (canonical encodings only), the same rule node:crypto applied before.
// The signature text must be canonical base64 (padded, nothing after the padding, no
// whitespace), so one signature has exactly one valid spelling in a receipt.
export function ed25519Valid(keyBase58, message, signatureBase64) {
  const raw = getAddressEncoder().encode(address(keyBase58));
  let sig;
  try { sig = base64ToBytes(signatureBase64); } catch { return false; }
  if (bytesToBase64(sig) !== signatureBase64) return false;
  if (raw.length !== 32 || sig.length !== 64) return false;
  return ed25519.verify(sig, utf8ToBytes(message), raw, { zip215: false });
}

async function rpcCall(url, method, params) {
  let res;
  // Public RPCs rate-limit (HTTP 429). Retry a few times so a transport problem
  // is not reported as an invalid binding; if it persists, the detail says "RPC error".
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(`${method}: RPC error HTTP ${res.status} (transport, not a verdict on the binding)`);
  const body = await res.json();
  if (body.error) {
    const err = new Error(`${method}: ${body.error.message} (code ${body.error.code})`);
    err.rpc = body.error;
    throw err;
  }
  return body.result;
}

const getTx = (url, sig, commitment) => rpcCall(url, "getTransaction", [sig, {
  commitment, maxSupportedTransactionVersion: 1, encoding: "jsonParsed",
}]);

export async function verifyBinding(doc, { requireSig = true, rpc, txOverride } = {}) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });

  const p = doc?.record?.payment;
  if (!p) throw new Error("missing record.payment");
  for (const k of ["amount", "asset", "from", "to", "tx", "network"]) {
    if (p[k] === undefined || p[k] === null || p[k] === "") throw new Error(`missing record.payment.${k}`);
  }
  if (!p.locator || !Number.isInteger(p.locator.index)) throw new Error("missing or non-integer record.payment.locator.index");
  if (typeof p.x402?.nonce !== "string") throw new Error("missing record.payment.x402.nonce");
  if (typeof p.amount !== "string" || !/^[0-9]+$/.test(p.amount)) throw new Error("record.payment.amount must be a decimal string of base units");
  const net = NETWORKS[p.network];
  if (!net) throw new Error(`unsupported network ${p.network}`);
  const rpcUrl = rpc || net.rpc;

  // Document-level consistency.
  add("version == nirium-payment-binding-v1", doc.version === VERSION, `version=${doc.version}`);
  add("network == record.payment.network", doc.network === p.network, `doc=${doc.network} payment=${p.network}`);
  add("locator.kind == svm-top-level-ix", p.locator.kind === "svm-top-level-ix", `kind=${p.locator.kind}`);
  add("x402.scheme == exact", p.x402.scheme === "exact", `scheme=${p.x402.scheme}`);
  const computed = contentSha256(doc.record);
  add("content_sha256 == sha256(canonical(record))", doc.content_sha256 === computed,
    `doc=${doc.content_sha256} computed=${computed}`);
  add("asset is Circle USDC for this network", p.asset === net.usdc, `asset=${p.asset} expected=${net.usdc}`);
  add("decimals == 6", p.decimals === 6, `decimals=${p.decimals}`);

  // Chain: right cluster.
  const genesis = await rpcCall(rpcUrl, "getGenesisHash", []);
  add("network == solana:<RPC genesis hash[0..32]>", p.network === `solana:${genesis.slice(0, 32)}`, `rpc genesis=${genesis}`);

  // Chain: the transaction.
  let tx = txOverride ?? null;
  if (!tx) {
    try {
      tx = await getTx(rpcUrl, p.tx, "finalized");
      if (!tx) {
        const conf = await getTx(rpcUrl, p.tx, "confirmed");
        add("tx found and finalized", false, conf ? "PENDING: confirmed but not finalized yet, retry later" : "not found on this network");
      }
    } catch (e) {
      add("tx found and finalized", false, e.message);
      tx = null;
    }
  }

  if (tx) {
    add("tx found and finalized", true, `slot=${tx.slot} blockTime=${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "n/a"}`);
    add("tx meta.err == null", tx.meta && tx.meta.err === null, `err=${JSON.stringify(tx.meta?.err)}`);
    const ver = tx.version === undefined ? "legacy" : tx.version;
    if (p.locator.txVersion !== undefined) {
      add("locator.txVersion == tx version", p.locator.txVersion === ver, `record=${p.locator.txVersion} tx=${ver}`);
    }

    const msg = tx.transaction.message;
    const ixs = msg.instructions;
    const idx = p.locator.index;
    const ix = ixs[idx];
    if (!ix) {
      add(`top-level ix ${idx} exists`, false, `tx has ${ixs.length} top-level instructions`);
    } else {
      const progOk = ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM;
      add(`ix ${idx} program is Token or Token-2022`, progOk, `program=${ix.programId}`);
      const isTc = ix.parsed?.type === "transferChecked";
      add(`ix ${idx} is transferChecked`, progOk && isTc, `type=${ix.parsed?.type ?? "unparsed"}`);
      if (progOk && isTc) {
        const info = ix.parsed.info;
        add("transfer.mint == payment.asset", info.mint === p.asset, `ix=${info.mint}`);
        add("transfer.amount == payment.amount", info.tokenAmount?.amount === p.amount, `ix=${info.tokenAmount?.amount} record=${p.amount}`);
        add("transfer.decimals == payment.decimals", info.tokenAmount?.decimals === p.decimals, `ix=${info.tokenAmount?.decimals}`);
        add("single-key authority (no multisig)", !!info.authority && !info.multisigAuthority, info.multisigAuthority ? `multisig=${info.multisigAuthority}` : "");
        add("transfer.authority == payment.from", info.authority === p.from, `ix=${info.authority}`);
        const signer = msg.accountKeys.find((k) => k.pubkey === info.authority)?.signer === true;
        add("authority signed the tx", signer);
        const expectedDest = await ata(p.to, p.asset, ix.programId);
        add("transfer.destination == ATA(payment.to, asset, program)", info.destination === expectedDest,
          `ix=${info.destination} expected=${expectedDest}`);
        // Defense in depth: the destination balance moved by exactly `amount`.
        const keyIdx = msg.accountKeys.findIndex((k) => k.pubkey === info.destination);
        const pre = tx.meta?.preTokenBalances?.find((b) => b.accountIndex === keyIdx && b.mint === info.mint);
        const post = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === keyIdx && b.mint === info.mint);
        const delta = post ? BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? "0") : null;
        add("destination balance delta == payment.amount", delta !== null && delta === BigInt(p.amount),
          `delta=${delta}`);
      }
    }

    const memos = ixs.filter((i) => i.programId === MEMO_PROGRAM);
    const memoText = (i) => (typeof i.parsed === "string" ? i.parsed : null);
    add("exactly one top-level Memo ix", memos.length === 1, `found ${memos.length}`);
    add("Memo text == x402.nonce", memos.length === 1 && memoText(memos[0]) === p.x402.nonce,
      `memo=${JSON.stringify(memos.map(memoText))} record=${JSON.stringify(p.x402.nonce)}`);
  }

  // Agent signature (payer).
  if (!requireSig) {
    add("agent signature (skipped: --no-sig)", true, "NOT checked");
  } else if (!doc.agent?.signature || !doc.agent?.key || !doc.agent?.statement) {
    add("agent block present", false, "agent.key, agent.statement and agent.signature are required");
  } else {
    const a = doc.agent;
    add("agent.alg == ed25519-solana", a.alg === "ed25519-solana", `alg=${a.alg}`);
    add("agent.statement == nirium-audit-v1:<content_sha256>", a.statement === STATEMENT_PREFIX + doc.content_sha256,
      `statement=${a.statement}`);
    add("agent.key == payment.from (payer signs)", a.key === p.from, `key=${a.key}`);
    let valid = false;
    try { valid = ed25519Valid(a.key, a.statement, a.signature); } catch {}
    add("ed25519 signature by agent.key over agent.statement", valid);
  }

  return { ok: checks.every((c) => c.ok), checks };
}
