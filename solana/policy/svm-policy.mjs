// Pre-sign policy gate for x402 `exact` payments on Solana.
//
// Same contract as the Stellar gate in the `nirium` package (x402-policy.ts) and the Avalanche
// gate: the policy engine is asked AFTER the exact transaction is built and BEFORE the payer
// signs, and only an ALLOW bound to that exact transaction, still valid, reaches the signer.
// DENY, WAIT, an error, a timeout, a malformed or stale answer, or a bad clock sign nothing.
//
// Where it hooks in: @x402/svm 2.32.0 builds the transaction and signs it inside
// createPaymentPayload (partiallySignTransactionMessageWithSigners). The only place where the
// bytes exist before the payer signs is the signer's signTransactions(), so the gate wraps it.
// It decodes the compiled message and refuses anything that is not exactly what an x402 `exact`
// payment for these requirements looks like, before the policy is consulted:
//   v0 only; 2 required signatures; no address lookup tables; fee payer = requirements.extra.feePayer
//   and not the payer; instructions exactly [SetComputeUnitLimit, SetComputeUnitPrice,
//   TransferChecked, Memo]; the transfer moves `amount` of `asset` from the payer's ATA to the
//   payTo's ATA (both computed here, not read from the transaction), with the asset's known
//   decimals and token program; one Memo equal to extra.memo (or a 32-hex nonce).
//
// Not a security boundary against code in the same process: whoever holds the base signer can
// still call it directly.

import { createHash } from "node:crypto";
import {
  address as toAddress, getAddressEncoder, getProgramDerivedAddress, getCompiledTransactionMessageDecoder,
} from "@solana/kit";

const DEFAULT_TIMEOUT_MS = 5000;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Assets the gate can check: decimals and token program come from here, never from the RPC. */
export const KNOWN_ASSETS = Object.freeze({
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": { symbol: "USDC", decimals: 6, tokenProgram: TOKEN_PROGRAM } },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": { symbol: "USDC", decimals: 6, tokenProgram: TOKEN_PROGRAM } },
});
export const DEFAULT_LIMITS = Object.freeze({ maxComputeUnitLimit: 200_000, maxComputeUnitPriceMicroLamports: 50_000n });

export class X402PolicyError extends Error {
  constructor(outcome, message, extra = {}) {
    super(`x402 policy ${outcome}: ${message}`);
    this.name = "X402PolicyError";
    this.outcome = outcome;
    this.decision = extra.decision;
    this.contextHash = extra.contextHash;
  }
}

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;
const mismatch = (msg) => new X402PolicyError("CONTEXT_MISMATCH", msg);
const readU32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const readU64 = (d, o) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i]); return v; };

export function assertValidPolicyHook(policy) {
  if (!policy || typeof policy !== "object" || typeof policy.evaluate !== "function") throw new Error("policy: `evaluate` must be a function.");
  if (policy.currentVersion !== undefined && typeof policy.currentVersion !== "function") throw new Error("policy: `currentVersion`, when set, must be a function.");
  if (policy.timeoutMs !== undefined && (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0)) throw new Error("policy: `timeoutMs` must be a positive integer (ms).");
  if (policy.now !== undefined && typeof policy.now !== "function") throw new Error("policy: `now`, when set, must be a function returning epoch milliseconds.");
}

export async function associatedTokenAddress(owner, mint, tokenProgram) {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: toAddress(ATA_PROGRAM),
    seeds: [enc.encode(toAddress(owner)), enc.encode(toAddress(tokenProgram)), enc.encode(toAddress(mint))],
  });
  return pda;
}

/**
 * Decodes the message about to be signed and checks it is exactly the x402 `exact` payment the
 * requirements describe. This is not policy (that belongs to the engine): it is context
 * integrity, so that what the engine evaluates is what gets signed.
 */
export async function describeAuthorization(messageBytes, requirements, signerAddress, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const assets = opts.assets || KNOWN_ASSETS;
  if (!(messageBytes instanceof Uint8Array) || messageBytes.length < 2) throw mismatch("no transaction message to sign");
  // Version from the prefix byte, before decoding: a v1 message decodes into another shape.
  const prefix = messageBytes[0];
  if ((prefix & 0x80) === 0) throw mismatch("legacy transaction; only v0 is gated");
  if ((prefix & 0x7f) !== 0) throw mismatch(`transaction version ${prefix & 0x7f}; only v0 is gated`);

  const net = assets[requirements.network];
  if (!net) throw mismatch(`unknown network ${requirements.network}`);
  const asset = net[requirements.asset];
  if (!asset) throw mismatch(`asset ${requirements.asset} is not a known asset on ${requirements.network}`);
  const feePayer = requirements.extra?.feePayer;
  if (!nonempty(feePayer)) throw mismatch("requirements.extra.feePayer is missing");

  let msg;
  try { msg = getCompiledTransactionMessageDecoder().decode(messageBytes); } catch (e) { throw mismatch(`undecodable message (${e?.message})`); }
  if (msg.version !== 0) throw mismatch(`decoded version ${String(msg.version)}`);
  if (msg.header?.numSignerAccounts !== 2) throw mismatch(`expected 2 required signatures, got ${msg.header?.numSignerAccounts}`);
  if (msg.addressTableLookups && msg.addressTableLookups.length) throw mismatch("address lookup tables are not allowed");
  const keys = msg.staticAccounts.map(String);
  if (keys[0] !== feePayer) throw mismatch("fee payer differs from requirements.extra.feePayer");
  if (feePayer === signerAddress) throw mismatch("the payer must not be the fee payer");
  if (keys[1] !== signerAddress) throw mismatch("the payer is not the second required signer");

  const ix = msg.instructions;
  if (!Array.isArray(ix) || ix.length !== 4) throw mismatch(`expected 4 instructions, got ${ix?.length}`);
  const prog = (i) => keys[ix[i].programAddressIndex];
  const data = (i) => ix[i].data ?? new Uint8Array();
  const accts = (i) => (ix[i].accountIndices ?? []).map((k) => keys[k]);

  if (prog(0) !== COMPUTE_BUDGET_PROGRAM || data(0)[0] !== 2 || data(0).length !== 5) throw mismatch("instruction 0 is not SetComputeUnitLimit");
  const computeUnitLimit = readU32(data(0), 1);
  if (computeUnitLimit > limits.maxComputeUnitLimit) throw mismatch(`compute unit limit ${computeUnitLimit} above ${limits.maxComputeUnitLimit}`);
  if (prog(1) !== COMPUTE_BUDGET_PROGRAM || data(1)[0] !== 3 || data(1).length !== 9) throw mismatch("instruction 1 is not SetComputeUnitPrice");
  const computeUnitPrice = readU64(data(1), 1);
  if (computeUnitPrice > BigInt(limits.maxComputeUnitPriceMicroLamports)) throw mismatch(`compute unit price ${computeUnitPrice} above ${limits.maxComputeUnitPriceMicroLamports}`);

  if (prog(2) !== TOKEN_PROGRAM && prog(2) !== TOKEN_2022_PROGRAM) throw mismatch("instruction 2 is not a token program");
  if (prog(2) !== asset.tokenProgram) throw mismatch("token program differs from the asset's known program");
  const t = data(2);
  if (t.length !== 10 || t[0] !== 12) throw mismatch("instruction 2 is not TransferChecked");
  const [source, mint, destination, authority, ...extra] = accts(2);
  if (extra.length || !authority) throw mismatch("TransferChecked has unexpected accounts");
  if (mint !== requirements.asset) throw mismatch("mint differs from requirements.asset");
  if (authority !== signerAddress) throw mismatch("transfer authority is not the payer");
  const amount = readU64(t, 1);
  if (amount !== BigInt(requirements.amount)) throw mismatch("amount differs from requirements.amount");
  if (t[9] !== asset.decimals) throw mismatch("decimals differ from the asset's known decimals");
  const sourceAta = await associatedTokenAddress(signerAddress, mint, asset.tokenProgram);
  const destinationAta = await associatedTokenAddress(requirements.payTo, mint, asset.tokenProgram);
  if (source !== sourceAta) throw mismatch("source is not the payer's associated token account");
  if (destination !== destinationAta) throw mismatch("destination is not the payTo's associated token account");

  if (prog(3) !== MEMO_PROGRAM || accts(3).length !== 0) throw mismatch("instruction 3 is not a Memo");
  let memo;
  try { memo = new TextDecoder("utf-8", { fatal: true }).decode(data(3)); } catch { throw mismatch("memo is not UTF-8"); }
  const sellerMemo = requirements.extra?.memo;
  if (nonempty(sellerMemo) ? memo !== sellerMemo : !/^[0-9a-f]{32}$/.test(memo)) throw mismatch("memo differs from requirements.extra.memo");

  return Object.freeze({
    version: 0,
    payloadHash: sha256hex(messageBytes),
    feePayer, from: signerAddress, to: requirements.payTo,
    sourceAta: String(sourceAta), destinationAta: String(destinationAta),
    mint, symbol: asset.symbol, tokenProgram: asset.tokenProgram,
    amount: amount.toString(), decimals: asset.decimals, memo,
    computeUnitLimit, computeUnitPrice: computeUnitPrice.toString(),
    recentBlockhash: String(msg.lifetimeToken),
  });
}

/** min(timeoutMs ?? 5000, maxTimeoutSeconds * 1000 / 2): a slow engine must not eat the payment window. */
export function effectiveTimeoutMs(policy, maxTimeoutSeconds) {
  const base = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof maxTimeoutSeconds === "number" && Number.isFinite(maxTimeoutSeconds) && maxTimeoutSeconds > 0) {
    return Math.max(1, Math.min(base, Math.floor((maxTimeoutSeconds * 1000) / 2)));
  }
  return base;
}

/** sha256 of {v, url, method, payloadHash}: the value an ALLOW must echo back. */
export function computeContextHash(url, method, payloadHash) {
  return sha256hex(Buffer.from(JSON.stringify({ v: 1, url, method, payloadHash }), "utf8"));
}

/**
 * Wraps a @solana/kit TransactionPartialSigner ({ address, signTransactions }) so it only signs
 * with a current ALLOW bound to this exact transaction. Anything else ends without a signature.
 * Create one gated signer per payment. `onRefused` receives the error before it is thrown,
 * because @x402/fetch re-wraps errors and loses their class.
 */
export function createPolicyGatedSigner(base, policy, getCall, onRefused, opts = {}) {
  assertValidPolicyHook(policy);
  if (!base || typeof base.signTransactions !== "function" || !nonempty(String(base.address ?? ""))) {
    throw new Error("createPolicyGatedSigner: base signer needs an address and signTransactions().");
  }
  const account = String(base.address);
  const now = policy.now ?? Date.now;

  const report = (r) => {
    try {
      const out = policy.onDecision?.(r);
      if (out !== null && (typeof out === "object" || typeof out === "function")) Promise.resolve(out).catch(() => {});
    } catch { /* an observer decides nothing */ }
  };
  const refuse = (outcome, msg, context, decision) => {
    report({ outcome, context, decision, error: msg });
    const err = new X402PolicyError(outcome, msg, { decision, contextHash: context?.contextHash });
    try { onRefused?.(err); } catch { /* idem */ }
    throw err;
  };
  const readClock = (context, decision) => {
    let t;
    try { t = now(); } catch (e) { return refuse("CLOCK_INVALID", `clock threw (${e?.message ?? String(e)})`, context, decision); }
    if (typeof t !== "number" || !Number.isFinite(t)) return refuse("CLOCK_INVALID", `clock returned ${String(t)}, not epoch milliseconds`, context, decision);
    return t;
  };

  const signTransactions = async (transactions, config) => {
    const call = getCall();
    if (!call || !call.requirements) refuse("CONTEXT_MISMATCH", "no payment requirements bound to this signing call");
    if (String(base.address) !== account) refuse("SIGNER_CHANGED", "base signer address changed after the gate was created");
    if (!Array.isArray(transactions) || transactions.length !== 1) refuse("CONTEXT_MISMATCH", `expected exactly one transaction, got ${transactions?.length}`);
    const tx = transactions[0];

    let authorization;
    try {
      authorization = await describeAuthorization(tx?.messageBytes, call.requirements, account, opts);
    } catch (e) {
      return refuse(e instanceof X402PolicyError ? e.outcome : "CONTEXT_MISMATCH", e?.message ?? String(e));
    }
    const contextHash = computeContextHash(call.url, call.method, authorization.payloadHash);
    const context = Object.freeze({
      contextVersion: 1, url: call.url, method: call.method,
      requirements: Object.freeze({ ...call.requirements, extra: Object.freeze({ ...(call.requirements.extra || {}) }) }),
      authorization, signer: account, contextHash,
    });

    const timeoutMs = effectiveTimeoutMs(policy, call.requirements.maxTimeoutSeconds);
    const controller = new AbortController();
    const deadline = readClock(context) + timeoutMs;
    let timer;
    const TIMED_OUT = Symbol("timeout");
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(TIMED_OUT); }, timeoutMs); });
    timeout.catch(() => {});

    try {
      let decision;
      try {
        decision = await Promise.race([Promise.resolve().then(() => policy.evaluate(context, { signal: controller.signal })), timeout]);
      } catch (e) {
        if (e === TIMED_OUT) return refuse("TIMEOUT", `no decision within ${timeoutMs} ms`, context);
        return refuse("ENGINE_ERROR", e?.message ?? String(e), context);
      }
      if (!decision || typeof decision !== "object") return refuse("MALFORMED", "engine returned no decision object", context);
      if (decision.decision === "DENY") return refuse("DENY", decision.reason ?? "denied", context, decision);
      if (decision.decision === "WAIT") return refuse("WAIT", decision.reason ?? "wait", context, decision);
      if (decision.decision !== "ALLOW") return refuse("MALFORMED", `unknown verdict ${String(decision.decision)}`, context, decision);
      const allow = Object.freeze({ ...decision });
      if (allow.contextHash !== contextHash) return refuse("UNBOUND", "ALLOW is not bound to this transaction", context, allow);
      if (allow.expiresAt !== undefined && (typeof allow.expiresAt !== "number" || !Number.isFinite(allow.expiresAt))) return refuse("MALFORMED", "expiresAt must be epoch milliseconds", context, allow);
      if (allow.expiresAt === undefined && policy.requireExpiry) return refuse("EXPIRED", "ALLOW without expiresAt while requireExpiry is set", context, allow);
      const checkClock = () => {
        const t = readClock(context, allow);
        if (t >= deadline) refuse("TIMEOUT", "decision arrived after the deadline", context, allow);
        if (allow.expiresAt !== undefined && t >= allow.expiresAt) refuse("EXPIRED", "ALLOW expired before signing", context, allow);
      };
      if (policy.currentVersion && !nonempty(allow.policyVersion)) return refuse("MALFORMED", "ALLOW has no policyVersion to check against currentVersion", context, allow);
      checkClock();
      report({ outcome: "ALLOWED", context, decision: allow });

      if (policy.currentVersion) {
        let current;
        try {
          current = await Promise.race([Promise.resolve().then(() => policy.currentVersion(context, { signal: controller.signal })), timeout]);
        } catch (e) {
          if (e === TIMED_OUT) return refuse("TIMEOUT", `no current policy version within ${timeoutMs} ms`, context, allow);
          return refuse("VERSION_UNAVAILABLE", `currentVersion failed (${e?.message ?? String(e)})`, context, allow);
        }
        if (!nonempty(current)) return refuse("VERSION_UNAVAILABLE", "currentVersion returned no version", context, allow);
        if (current !== allow.policyVersion) return refuse("STALE", `ALLOW was issued under policy ${allow.policyVersion}, current is ${current}`, context, allow);
      }

      checkClock();
      if (String(base.address) !== account) return refuse("SIGNER_CHANGED", "base signer address changed while the policy was evaluated", context, allow);
      if (timer) clearTimeout(timer);
      let out;
      try {
        // The original array, not a copy someone could have touched.
        out = await base.signTransactions(transactions, config);
      } catch (e) {
        report({ outcome: "SIGNER_ERROR", context, decision: allow, error: e?.message ?? String(e) });
        throw e;
      }
      const sig = Array.isArray(out) && out.length === 1 ? out[0]?.[account] : undefined;
      if (!(sig instanceof Uint8Array) || sig.length !== 64) return refuse("SIGNER_ERROR", "signer returned no 64-byte signature for the payer", context, allow);
      report({ outcome: "SIGNED", context, decision: allow });
      return out;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return Object.freeze({ address: base.address, signTransactions });
}
