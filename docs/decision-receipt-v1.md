# nirium-decision-v1

A receipt for a decision the payer's pre-sign policy made about an x402 payment: ALLOWED,
DENY, WAIT, and every other refusal. It is signed by the payer's own key, so it records what the
payer's policy decided, in the payer's name.

A payment receipt (`payment-binding-v1.md`) is bound to a transfer the chain already shows. A
decision receipt matters most when there is **no** transfer: a DENY or a WAIT signs nothing, so the
chain has no trace of it. The receipt is the only record that the payment was attempted, what it
would have paid, and why it was refused. That is the part the chain does not keep.

## Document

```json
{
  "version": "nirium-decision-v1",
  "content_sha256": "<sha256 hex of canonical(record)>",
  "record": {
    "decision": {
      "outcome": "DENY",
      "policyVersion": "rules-v1",
      "reason": "amount 10000 above limit 5000"
    },
    "intent": {
      "amount": "10000",
      "asset": "<SPL mint | ERC-20 address>",
      "contextHash": "<sha256 hex the policy bound its answer to>",
      "decimals": 6,
      "from": "<payer wallet>",
      "method": "GET",
      "network": "<CAIP-2, solana:* or eip155:*>",
      "nonce": "<Memo text | EIP-3009 nonce>",
      "payloadHash": "<sha256 of the transaction message (Solana) | EIP-712 digest (EVM)>",
      "resource": "<paid URL>",
      "to": "<payTo wallet>"
    },
    "labels": ["selftest"],
    "purpose": { "note": "<short, no personal data>", "ref": "<order reference>" }
  },
  "agent": {
    "alg": "ed25519-solana | eip191-secp256k1",
    "key": "<payer wallet>",
    "signature": "<base64 | 0x hex>",
    "statement": "nirium-audit-v1:<content_sha256>"
  },
  "network": "<same as record.intent.network>"
}
```

- `record` keys are sorted recursively and serialized without whitespace (`canonical`), the same
  rule as payment receipts, so `content_sha256 = sha256(canonical(record))`.
- `decision.outcome` is the policy outcome: `ALLOWED`, `SIGNED`, `DENY`, `WAIT`, `TIMEOUT`,
  `ENGINE_ERROR`, `EXPIRED`, `UNBOUND`, `MALFORMED`, `STALE`, `VERSION_UNAVAILABLE`,
  `SIGNER_CHANGED`, `CLOCK_INVALID`. `CONTEXT_MISMATCH` happens before there is a decoded
  payment to describe, so it has no decision receipt.
- `reason` and `policyVersion` are what the engine returned, as text. Omit them when absent.
- `intent` comes from what the policy decoded from the transaction or the typed data itself, not
  from what the seller said.
- The payer signs. `agent.key` must equal `record.intent.from`.

### Hash-only mode

To keep the content private, the document has no `record`:

```json
{
  "version": "nirium-decision-v1",
  "content_sha256": "<sha256 hex of canonical(record), kept by the payer>",
  "agent": { "alg": "...", "key": "<payer>", "signature": "...", "statement": "nirium-audit-v1:<content_sha256>" },
  "network": "<CAIP-2>"
}
```

Anyone holding the record can later show it matches `content_sha256`; anyone else only sees that
the payer signed something at that time.

## What a verifier checks

1. `version`, `network` (CAIP-2, `solana:*` or `eip155:*`) and, with a record,
   `record.intent.network == network`.
2. With a record: `content_sha256 == sha256(canonical(record))`, and the outcome is one listed
   above.
3. `agent.statement == "nirium-audit-v1:" + content_sha256`, `agent.alg` matches the network
   family, the signature is valid for `agent.key` (raw ed25519 over the UTF-8 statement on Solana;
   EIP-191 address recovery on EVM), and with a record `agent.key == record.intent.from`.

There is nothing to check on-chain: the point of a refusal is that nothing reached the chain. For
an `ALLOWED`/`SIGNED` decision, the payment receipt of the transfer that followed is the on-chain
proof.

## What it does not prove

That the policy was configured sensibly, that the payer's software really ran it, or that nothing
else signed with the same key. It proves that the holder of the payer's key declared this decision,
for this exact payment, and when it was anchored.
