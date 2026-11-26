# Nirium devnet demo: x402 exact payment on Solana with a payment binding

Reference code for paying an x402 resource on Solana with PayAI as facilitator, then
writing a `nirium-payment-binding-v1` receipt bound to the exact SPL transfer
(tx signature + top-level instruction index) and checking it with
`../verify-svm-receipt.mjs`.

Private working copy. Nothing here has been committed, deployed or published.

Pinned versions: `@x402/core`, `@x402/express`, `@x402/fetch`, `@x402/svm` 2.32.0,
`@solana/kit` 8.6.0, `express` 5.3.0 (the `@x402/express` peer range is
`^4.22.3 || ^5.3.0`). Node 24.

```
npm install --ignore-scripts
```

## Files

| File | What it does | Keys |
|---|---|---|
| `server.mjs` | Resource server. `GET /paid` costs 10000 base units of devnet USDC (0.01). `extra.memo` comes from the `X-Nirium-Ref` header | None |
| `client.mjs` | Payer. Pins `transactionVersions: [0]`, only pays the expected network, asset, memo and amount cap | Payer keypair file, from env |
| `make-binding.mjs` | Reads the settled tx, builds the binding in canonical order, signs it as the payer | Payer keypair file, from env (or `--no-sign`) |

## Before the first payment (by hand, outside this code)

1. A payer keypair for this project only (never a key from another project),
   with devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) in its token account.
   It does not need SOL: the facilitator is the fee payer.
2. A payTo wallet whose devnet USDC token account **already exists**. Without it, PayAI
   rejects with `invalid_exact_svm_recipient_ata_missing` (seen on 26-nov).

## Run (devnet)

```
# terminal 1
PAY_TO=<payTo wallet> node server.mjs

# terminal 2
NIRIUM_PAYER_KEYPAIR=<path> node client.mjs \
  --url http://localhost:4021/paid --ref selftest-2026-11-26-sol-devnet-01
# prints the tx signature from PAYMENT-RESPONSE

NIRIUM_PAYER_KEYPAIR=<path> node make-binding.mjs --tx <signature> \
  --ref selftest-2026-11-26-sol-devnet-01 --resource http://localhost:4021/paid \
  --label selftest --note "team self-test" --out out/s1.json

node ../verify-svm-receipt.mjs out/s1.json
```

Mainnet (the labeled self-test) also needs `NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
on the server, `--network solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` on the client and
`make-binding.mjs`, and `NIRIUM_ALLOW_MAINNET=1` on the client. It moves real funds from
the operator's own wallet: a team self-test, never usage.

## Why it is built this way (read in the 2.32.0 packages, checked on 26-nov)

- **Deterministic memo.** When the paid retry arrives, the server rebuilds the
  requirements and checks `extra` as a subset of what the client accepted
  (`paymentRequirementsMatchAccepted`; only `recentBlockhash` and `lastValidBlockHeight`
  are exempt). A random memo per request would never match. The memo comes from the
  client's `X-Nirium-Ref`, returned by a `DynamicPrice` as `extra.memo`, and ends up as
  `purpose.ref` in the binding. Without the header there is no `extra.memo` and the client
  writes a random 32-hex nonce instead. A malformed ref gets HTTP 400.
- **v0 on purpose.** The `exact` server copies `transactionVersions` from the
  facilitator's `/supported`, PayAI advertises `[0, 1]`, and the client builds the highest
  common version. With the default client config it built a **v1** tx (first message
  byte `0x81`); pinned to `[0]` it built v0 with `[ComputeBudget, ComputeBudget,
  TransferChecked, Memo]`, so the transfer is at index 2. `registerExactSvmScheme()` on
  the client takes no `ClientSvmConfig`, so the scheme is registered by hand.
- **The tx signature exists only after settlement** (it is the facilitator's fee-payer
  signature), so the binding is made after the `PAYMENT-RESPONSE` comes back.
- **The verifier asks for `maxSupportedTransactionVersion: 1`.** With 0, the RPC answers
  error -32015 for a v1 tx (checked on 26-nov).

## Tested on 26-nov (no funds moved)

- Server: 402 without the header has no `extra.memo`; with the header, `extra.memo` equals
  the ref, the same on repeated calls; a malformed ref gets 400.
- Client with an unfunded throwaway key against the local server and PayAI devnet: the
  payload carried a v0 tx with the ref as Memo, the server matched the requirements and
  forwarded to PayAI, and PayAI rejected with `invalid_exact_svm_recipient_ata_missing`
  (the throwaway payTo had no token account). Nothing settled. The throwaway key was
  deleted.
- Client guards: no key file gives exit 2; mainnet without `NIRIUM_ALLOW_MAINNET=1` gives
  exit 2.
- `make-binding.mjs --no-sign` on two third-party txs (fixtures only, not ours, not usage):
  the PayAI mainnet v0 settlement (index 2) and the devnet v1 tx from x402 issue #4383
  (index 0). Both are VALID under `../verify-svm-receipt.mjs --no-sig`.
- `make-binding.mjs` with a key that is not the transfer authority refuses to sign (exit 1,
  no file written).

Not tested yet: a real paid run and a binding signed by the real payer. That needs the
funded payer and payTo accounts above.
