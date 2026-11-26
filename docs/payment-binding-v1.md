# nirium-payment-binding-v1

A receipt that binds a signed statement to one specific on-chain transfer. It is the same document
shape Nirium Audit Trail already uses (`record` + `agent`), so existing Audit Trail verifiers
compute the same hash.

## Document

```json
{
  "version": "nirium-payment-binding-v1",
  "content_sha256": "<sha256 hex of canonical(record)>",
  "record": {
    "labels": ["selftest"],
    "payment": {
      "amount": "10000",
      "asset": "<SPL mint | ERC-20 address>",
      "decimals": 6,
      "from": "<payer wallet>",
      "locator": { "index": 2, "kind": "svm-top-level-ix", "txVersion": 0 },
      "network": "<CAIP-2, e.g. solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 or eip155:43113>",
      "to": "<payTo wallet>",
      "tx": "<Solana signature | 0x EVM tx hash>",
      "x402": { "nonce": "<Memo text | EIP-3009 nonce>", "resource": "<paid URL>", "scheme": "exact" }
    },
    "purpose": { "note": "<short, no personal data>", "ref": "<order reference>" }
  },
  "agent": {
    "alg": "ed25519-solana | eip191-secp256k1",
    "key": "<payer wallet>",
    "signature": "<base64 | 0x hex>",
    "statement": "nirium-audit-v1:<content_sha256>"
  },
  "network": "<same as record.payment.network>"
}
```

- On EVM, `locator` is `{ "index": <logIndex>, "kind": "evm-log" }`. `logIndex` is the log's index
  within the block, as returned by `eth_getLogs` and transaction receipts.
- `canonical(record)`: keys sorted recursively, no whitespace, strings as `JSON.stringify` writes
  them. Producers build `record` already in that order, so `JSON.stringify(record)` gives the same
  bytes.
- Amounts are strings in atomic units (`"10000"` is 0.01 USDC).
- The payer signs. Verifiers require `agent.key == record.payment.from`.

## What a verifier checks

Solana (`getTransaction`, `finalized`, `maxSupportedTransactionVersion: 1`, `jsonParsed`):

1. The transaction exists, is finalized and has no error; its version equals `locator.txVersion`.
2. The top-level instruction at `locator.index` is a Token or Token-2022 `transferChecked`.
3. Its mint, amount and decimals equal the receipt; its authority equals `from`; its destination
   is the associated token account of `to` for that mint and token program.
4. There is one Memo instruction whose text equals `x402.nonce`.
5. The record hash matches `content_sha256`, and `agent.signature` is a valid ed25519 signature by
   `agent.key` over `agent.statement`.

EVM (`eth_getTransactionReceipt`):

1. Status is success and the RPC chain id matches `network`.
2. The log at `locator.index` was emitted by `asset`, is a `Transfer`, and its from, to and value
   equal the receipt. The transaction's own `to` is not used: facilitators may settle in a batch.
3. The same receipt has an `AuthorizationUsed(from, x402.nonce)` log emitted by `asset`.
4. The record hash matches `content_sha256`, and the EIP-191 signer of `agent.statement` is `from`.

## What it does not prove

The chain proves the transfer. The receipt adds who declared it and what it was for (`purpose`).
It does not prove that the goods or service were delivered.
