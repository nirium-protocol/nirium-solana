// Decision receipts ("nirium-decision-v1") on Solana: a payer-signed record of what the pre-sign
// policy decided about an x402 payment, including the ones that were never signed (DENY, WAIT and
// every other refusal), which leave no trace on the chain. Format: docs/decision-receipt-v1.md.
//
// No Node-only APIs: runs in Node and in the browser, like the receipt verifier.

import { canonicalize, contentSha256, ed25519Valid, bytesToBase64, STATEMENT_PREFIX } from "../verify-svm-core.mjs";

export const DECISION_VERSION = "nirium-decision-v1";
export const DECISION_OUTCOMES = Object.freeze([
  "ALLOWED", "SIGNED", "DENY", "WAIT", "TIMEOUT", "ENGINE_ERROR", "EXPIRED", "UNBOUND", "MALFORMED",
  "STALE", "VERSION_UNAVAILABLE", "SIGNER_CHANGED", "CLOCK_INVALID",
]);
const SOLANA_NETWORK = /^solana:[1-9A-HJ-NP-Za-km-z]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * The record for one policy decision, in canonical key order, or null when the policy refused
 * before it had decoded a payment (CONTEXT_MISMATCH): there is nothing to describe then.
 * @param {object} policyRecord what the policy passed to onDecision: { outcome, context, decision, error }
 * @param {object} [o] { ref, note, labels }
 */
export function decisionRecord(policyRecord, { ref, note, labels = [] } = {}) {
  const c = policyRecord?.context;
  const a = c?.authorization;
  if (!a || !c?.requirements?.network) return null;
  const outcome = policyRecord.outcome;
  if (!DECISION_OUTCOMES.includes(outcome)) throw new Error(`decisionRecord: unknown outcome ${outcome}`);
  const d = policyRecord.decision ?? {};
  const decision = { outcome };
  if (nonempty(d.policyVersion)) decision.policyVersion = String(d.policyVersion);
  const reason = nonempty(d.reason) ? d.reason : (nonempty(policyRecord.error) ? policyRecord.error : undefined);
  if (reason) decision.reason = String(reason).slice(0, 280);
  const intent = {
    amount: String(a.amount), asset: String(a.mint), contextHash: String(c.contextHash), decimals: Number(a.decimals),
    from: String(a.from), method: String(c.method), network: String(c.requirements.network), nonce: String(a.memo),
    payloadHash: String(a.payloadHash), resource: String(c.url), to: String(a.to),
  };
  const record = { decision, intent, labels: [...labels].map(String) };
  if (nonempty(ref)) record.purpose = note ? { note: String(note), ref } : { ref };
  return JSON.parse(canonicalize(record));
}

/**
 * Builds and signs a decision receipt with the payer's @solana/kit message signer.
 * Returns { doc, record } (null when there is no decoded payment). With hashOnly, `doc` has no
 * record: keep `record` yourself to show it later.
 */
export async function bindDecision(policyRecord, { signer, ref, note, labels, hashOnly = false } = {}) {
  const record = decisionRecord(policyRecord, { ref, note, labels });
  if (!record) return null;
  if (!signer || typeof signer.signMessages !== "function") throw new Error("bindDecision: signer must be the payer's @solana/kit MessagePartialSigner");
  if (String(signer.address) !== record.intent.from) throw new Error(`bindDecision: signer ${signer.address} is not the payer ${record.intent.from}`);
  const content_sha256 = contentSha256(record);
  const statement = STATEMENT_PREFIX + content_sha256;
  const [dict] = await signer.signMessages([{ content: new TextEncoder().encode(statement), signatures: {} }]);
  const sig = dict?.[record.intent.from];
  if (!(sig instanceof Uint8Array) || sig.length !== 64) throw new Error("bindDecision: signer returned no 64-byte signature");
  const agent = { alg: "ed25519-solana", key: record.intent.from, signature: bytesToBase64(sig), statement };
  const network = record.intent.network;
  const doc = hashOnly
    ? { version: DECISION_VERSION, content_sha256, agent, network }
    : { version: DECISION_VERSION, content_sha256, record, agent, network };
  return { doc, record };
}

/**
 * Checks a decision receipt: format, hash (with a record), payer signature. Nothing on-chain: a
 * refusal leaves nothing there. For a hash-only document, pass { record } to check that it is the
 * record behind content_sha256. Returns { ok, checks: [{ name, ok, detail }] }.
 */
export async function verifyDecision(doc, { record: heldRecord } = {}) {
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) }); return Boolean(ok); };
  const d = doc ?? {};
  check("version == nirium-decision-v1", d.version === DECISION_VERSION, String(d.version));
  check("network is a Solana CAIP-2 id", SOLANA_NETWORK.test(String(d.network)), String(d.network));
  check("content_sha256 is 64 hex", HEX64.test(String(d.content_sha256)));
  const record = d.record ?? heldRecord;
  if (record) {
    let canon;
    try { canon = canonicalize(record); } catch { canon = null; }
    check("content_sha256 == sha256(canonical(record))", canon !== null && contentSha256(record) === d.content_sha256,
      d.record ? undefined : "record held by the verifier (hash-only document)");
    check("decision.outcome is a known outcome", DECISION_OUTCOMES.includes(record?.decision?.outcome), String(record?.decision?.outcome));
    check("record.intent.network == network", record?.intent?.network === d.network);
  }
  const ag = d.agent ?? {};
  const statementOk = check("agent.statement == nirium-audit-v1:<content_sha256>", ag.statement === STATEMENT_PREFIX + d.content_sha256);
  check("agent.alg == ed25519-solana", ag.alg === "ed25519-solana", String(ag.alg));
  if (record) check("agent.key == record.intent.from (the payer signs)", ag.key === record?.intent?.from);
  let sigOk = false;
  if (statementOk && typeof ag.key === "string" && typeof ag.signature === "string") {
    try { sigOk = ed25519Valid(ag.key, ag.statement, ag.signature); } catch { sigOk = false; }
  }
  check("ed25519 signature by agent.key over agent.statement", sigOk);
  return { ok: checks.every((c) => c.ok), checks };
}

/** An onDecision observer that keeps every policy record, to sign after the payment attempt. */
export function collectDecisions() {
  const records = [];
  return { records, onDecision: (r) => { records.push(r); } };
}
