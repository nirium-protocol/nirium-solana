# Pre-sign policy for x402 on Solana

A payment that your policy refuses is never signed.

`@x402/svm` builds the transaction and has the payer's signer sign it in the same call. This
package wraps that signer: before the payer signs, it decodes the transaction message, checks it
is exactly the x402 `exact` payment the seller asked for, asks your policy, and only signs on an
ALLOW bound to that exact transaction and still valid. Everything else ends without a
signature, so nothing reaches the seller or the facilitator.

It is the same contract as the Stellar policy hook in the `nirium` package and the Avalanche gate:
same verdicts, same outcomes, same `contextHash`.

## Use

```js
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { createPolicyX402Fetch } from "./x402-fetch.mjs";
import { createRulesPolicy } from "./rules-policy.mjs";

const pay = createPolicyX402Fetch({
  signer: await createKeyPairSignerFromBytes(secretKeyBytes),
  policy: createRulesPolicy({ maxAmount: "10000", allowPayTo: ["<seller>"], allowFeePayers: ["<facilitator fee payer>"] }),
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // devnet
});
const res = await pay("https://seller.example/paid", { headers: { "X-Nirium-Ref": "order-42" } });
```

`createPolicyX402Fetch` registers `ExactSvmScheme` by hand with `transactionVersions: [0]`
(`registerExactSvmScheme` does not pass that option) and only the `exact` scheme, so `upto` and
`batch-settlement` offers are never paid.

## What is checked before the policy is asked

From the message bytes, not from what the seller said. Any mismatch is `CONTEXT_MISMATCH` and the
engine is not consulted:

- v0 message only (legacy and v1 are refused), exactly 2 required signatures, no address lookup
  tables.
- Fee payer = `requirements.extra.feePayer`, and it is not the payer.
- Instructions exactly `[SetComputeUnitLimit, SetComputeUnitPrice, TransferChecked, Memo]`, with
  compute limits under a cap. Any extra instruction (a System transfer, an Approve, a
  SetAuthority, a durable nonce, a second transfer) is refused.
- `TransferChecked`: the asset's known token program, mint = `requirements.asset`, amount =
  `requirements.amount`, decimals from a fixed table (not from the RPC), authority = the payer,
  source = the payer's ATA and destination = the payTo's ATA, both computed here.
- One Memo, equal to `extra.memo` byte for byte (or a 32-hex nonce when the seller sets none).

`context.authorization` gives the engine the decoded `amount`, `mint`, `decimals`, `to`,
`destinationAta`, `feePayer`, `memo` and `payloadHash` (sha256 of the message bytes).

## Tests

```bash
npm ci && npm test   # 38 tests, no network
```

A local fake RPC answers only the mint account and the blockhash comes in `extra`, so the real
`@x402/svm` 2.32.0 builds the real transaction offline. Vectors: valid payments (V), policy
refusals (R) and 24 tampered transactions (D1-D24: amount, mint, destination, source, authority,
decimals, Transfer instead of TransferChecked, extra instructions, reordering, memo, fee payer,
signer count, lookup tables, durable nonce, legacy/v1, compute price, two transactions, extra
data byte, Token-2022 program). In every refusal the base signer is never called. A sanity test
checks that re-encoding the real message unchanged gives the same bytes, so each D vector fails
for its own change. The last test runs `@x402/fetch` end to end against a local seller.

## Live run (devnet)

`demo-pay.mjs` pays the `../devnet-demo` server through this gate, allowing only PayAI's
published fee payers. See `../../evidence/README.md` for a DENY, a WAIT and an ALLOW against PayAI
on devnet, with the payer's balance before and after.

## Limits

- Only `exact` with a local key (agent mode). A browser wallet that modifies the transaction
  before signing needs its own decoding pass; not covered yet.
- Token-2022 mints with transfer-fee or transfer-hook extensions are not in the known-asset table.
- Not a security boundary against code in the same process.
