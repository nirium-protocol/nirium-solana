// bindReceipt(): builds a "nirium-payment-binding-v1" receipt for a settled x402 payment on
// Solana, bound to the top-level TransferChecked (by index) and its Memo, and signs it as the
// payer when a signer is given. Format: docs/payment-binding-v1.md.
//
// The receipt adds what the chain does not keep: who declared the payment and what it was for
// (`purpose`). It does not prove delivery.

import { canonicalize, contentSha256, verifyBinding, VERSION, STATEMENT_PREFIX } from "../verify-svm-receipt.mjs";
import { getNetwork, rpcCall } from "./networks.mjs";

const TOKEN = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/**
 * @param {object} o
 * @param {string} o.tx        settled tx signature (PAYMENT-RESPONSE `transaction`)
 * @param {string} o.network   CAIP-2 (devnet or mainnet)
 * @param {string} o.ref       order reference (purpose.ref); normally equal to the on-chain Memo
 * @param {string} [o.resource] the paid URL
 * @param {string} [o.note]    short, no personal data
 * @param {string[]} [o.labels] e.g. ["selftest"]; default []
 * @param {object} [o.signer]  the payer as a @solana/kit MessagePartialSigner ({ address, signMessages }),
 *                             e.g. a KeyPairSigner; omit for an unsigned receipt
 * @param {string} [o.to]      payTo wallet, if the destination owner cannot be read from token balances
 * @param {number} [o.index]   top-level instruction index, when the tx has more than one TransferChecked
 * @param {string} [o.rpcUrl]
 * @param {number} [o.waitMs]  how long to wait for finality, default 90000
 */
export async function bindReceipt(o) {
  const net = getNetwork(o.network);
  if (typeof o.ref !== "string" || !o.ref.trim()) throw new Error("bindReceipt: ref (purpose.ref) is required");
  const rpc = o.rpcUrl ?? net.rpc;

  let tx = null;
  const deadline = Date.now() + (o.waitMs ?? 90_000);
  for (;;) {
    tx = await rpcCall(rpc, "getTransaction", [o.tx, { commitment: "finalized", maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]);
    if (tx || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!tx) throw new Error(`tx ${o.tx} not finalized on ${o.network} in time`);
  if (tx.meta?.err !== null) throw new Error(`tx failed on chain: ${JSON.stringify(tx.meta?.err)}`);

  const ixs = tx.transaction.message.instructions;
  const isTc = (i) => TOKEN.includes(i.programId) && i.parsed?.type === "transferChecked";
  let index = o.index;
  if (index === undefined) {
    const found = ixs.flatMap((i, n) => (isTc(i) ? [n] : []));
    if (found.length !== 1) throw new Error(`expected exactly one top-level TransferChecked, found ${found.length}; pass index`);
    index = found[0];
  } else if (!ixs[index] || !isTc(ixs[index])) throw new Error(`top-level instruction ${index} is not a TransferChecked`);
  const info = ixs[index].parsed.info;
  if (!info.authority || info.multisigAuthority) throw new Error("multisig authority is not supported");
  const memos = ixs.filter((i) => i.programId === MEMO);
  if (memos.length !== 1 || typeof memos[0].parsed !== "string") throw new Error(`expected exactly one top-level Memo, found ${memos.length}`);

  const keys = tx.transaction.message.accountKeys;
  const destIdx = keys.findIndex((k) => k.pubkey === info.destination);
  const destOwner = tx.meta.postTokenBalances?.find((b) => b.accountIndex === destIdx)?.owner;
  const to = o.to ?? destOwner;
  if (!to) throw new Error("could not determine the payTo wallet; pass `to`");
  if (destOwner && to !== destOwner) throw new Error(`to ${to} is not the owner of the destination token account (${destOwner})`);

  const x402 = { nonce: memos[0].parsed, scheme: "exact" };
  if (o.resource) x402.resource = o.resource;
  const purpose = { ref: o.ref };
  if (o.note) purpose.note = o.note;
  const record = JSON.parse(canonicalize({
    labels: o.labels ?? [],
    payment: {
      amount: info.tokenAmount.amount, asset: info.mint, decimals: info.tokenAmount.decimals, from: info.authority,
      locator: { index, kind: "svm-top-level-ix", txVersion: tx.version === undefined ? "legacy" : tx.version },
      network: o.network, to, tx: o.tx, x402,
    },
    purpose,
  }));
  if (JSON.stringify(record) !== canonicalize(record)) throw new Error("record is not in canonical order (bug)");
  const content_sha256 = contentSha256(record);

  let agent;
  if (o.signer) {
    if (String(o.signer.address) !== info.authority) throw new Error(`signer ${o.signer.address} is not the transfer authority ${info.authority}`);
    if (typeof o.signer.signMessages !== "function") throw new Error("signer must implement signMessages (a @solana/kit MessagePartialSigner)");
    const statement = STATEMENT_PREFIX + content_sha256;
    const [dict] = await o.signer.signMessages([{ content: new TextEncoder().encode(statement), signatures: {} }]);
    const sig = dict?.[info.authority];
    if (!(sig instanceof Uint8Array) || sig.length !== 64) throw new Error("signer returned no 64-byte signature");
    agent = { alg: "ed25519-solana", key: info.authority, signature: Buffer.from(sig).toString("base64"), statement };
  }
  return { version: VERSION, content_sha256, record, ...(agent ? { agent } : {}), network: o.network };
}

/** Verifies a receipt against the chain. Returns { ok, checks }. */
export function verifyReceipt(doc, { requireSignature = true, rpcUrl } = {}) {
  return verifyBinding(doc, { requireSig: requireSignature, rpc: rpcUrl });
}
