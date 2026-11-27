# nirium-solana

[![tests](https://github.com/nirium-protocol/nirium-solana/actions/workflows/tests.yml/badge.svg)](https://github.com/nirium-protocol/nirium-solana/actions/workflows/tests.yml)
[![CodeQL](https://github.com/nirium-protocol/nirium-solana/actions/workflows/codeql.yml/badge.svg)](https://github.com/nirium-protocol/nirium-solana/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/nirium-solana.svg)](https://www.npmjs.com/package/nirium-solana)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Pay and charge with x402 on Solana, refuse a payment before it is signed, and keep a receipt
that says what the payment was for.

The chain already shows who paid whom, how much, and when. A Nirium receipt adds what the chain
does not keep: which order a payment was for and who declared it, signed by the payer and bound
to one specific SPL transfer. Anyone can check it against Solana with a public RPC and nothing
else from us.

This is [Nirium](https://nirium.xyz) on Solana. Nirium started on Stellar; this repo brings the
same receipt format and the same pre-sign policy contract to Solana.

## Status

| Piece | Devnet | Mainnet |
|---|---|---|
| Receipt verifier (`solana/verify-svm-receipt.mjs`) | yes | yes, one team self-test payment |
| Pre-sign policy (`solana/policy/`) | yes, DENY / WAIT / ALLOW runs | yes, one team self-test purchase (ALLOWED, SIGNED) |
| Pay and charge library (`solana/sdk/`) | yes | yes, the same purchase, with the published npm package |
| x402 market (`solana/market/`) | yes | live on Fly; one team self-test sale so far |

Every payment listed in [`evidence/`](evidence/README.md) was made by the team to test the flow.
They are labeled `selftest` and are not usage. Nothing here has had an external audit.

## What is here

| Path | What it does |
|---|---|
| [`docs/payment-binding-v1.md`](docs/payment-binding-v1.md) | The receipt format and what a verifier checks |
| [`solana/verify-svm-receipt.mjs`](solana/verify-svm-receipt.mjs) | Checks a receipt against an SPL `TransferChecked`: tx signature, top-level instruction index, Memo, payer signature |
| [`solana/sdk/`](solana/sdk/README.md) | The library: `x402Serve` to charge, `createX402Fetch` to pay (with an optional policy), `bindReceipt` and `verifyReceipt` |
| [`solana/policy/`](solana/policy/README.md) | Pre-sign policy: the transaction is decoded and checked, then your policy decides; a refused payment is never signed |
| [`solana/market/`](solana/market/README.md) | x402 market: Solana network conditions (priority fees, throughput, slot time) for $0.01 per query |
| [`solana/devnet-demo/`](solana/devnet-demo/README.md) | Reference x402 `exact` payment with PayAI as facilitator, then the receipt |
| [`scripts/`](scripts) | Devnet key setup and the payTo token account |
| [`evidence/`](evidence/README.md) | The team's test payments, each with its receipt and explorer link |

## Quick start

```bash
npm install nirium-solana
```

One package with the library, the pre-sign policy (`nirium-solana/policy`) and the receipt verifier
(`nirium-solana/verify`, and `npx nirium-verify-svm receipt.json` on the command line). Its own README is
[`solana/README.md`](solana/README.md).

Check one of the team's receipts against the chain:

```bash
cd solana && npm ci
node verify-svm-receipt.mjs ../evidence/2026-11-26/solana-devnet-binding.json
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input. `--no-sig` skips the
signature check and says so in the output; it is only for testing against third-party
transactions.

Charge for your own API and pay for someone else's (devnet):

```js
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, createRulesPolicy, DEVNET } from "nirium-solana";

app.use(x402Serve({ payTo: "<your wallet>", network: DEVNET, routes: { "GET /data": "$0.01" } }));

const pay = createX402Fetch({ signer, network: DEVNET, maxAmountPerPayment: "10000",
  policy: createRulesPolicy({ maxAmount: "10000" }) });
const res = await pay("https://seller.example/data", { headers: { "X-Nirium-Ref": "order-42" } });
const receipt = await bindReceipt({ tx: settlementOf(res).transaction, network: DEVNET, ref: "order-42", signer });
```

`x402Serve` runs on your server: Nirium runs nothing in the middle and receives nothing. More in
[`solana/sdk/README.md`](solana/sdk/README.md).

## Tests

| Suite | Command | Network |
|---|---|---|
| Verifier, 21 cases against real transactions | `cd solana && npm ci && node test-live.mjs` | public mainnet and devnet RPC |
| Pre-sign policy, 38 tests | `cd solana && npm ci && npm run test:policy` | none |
| Library, 8 tests | `cd solana && npm ci && npm run test:sdk` | one test reads the public devnet RPC |
| Market, 3 tests | `cd solana && npm ci && cd market && npm ci && npm test` | none |

CI runs all of them on every pull request. The verifier fixtures point at third-party payments
and are labeled as such: they test the verifier, they are not usage of this project.

## Rules this code follows

- Non-custodial: every key belongs to whoever pays or receives. Nirium never holds one.
- Mainnet payments need an explicit opt-in on the client (`NIRIUM_ALLOW_MAINNET=1` or
  `allowMainnet: true`).
- Settlement is done by PayAI, an independent facilitator. Nirium runs no facilitator.
- Receipts are tamper-evident, not tamper-proof: an edited receipt no longer matches its hash or
  its signature. A receipt does not prove that goods or a service were delivered.
- Keys never go in this repo. The key scripts write outside it and refuse to run inside it.

## Security

See [SECURITY.md](SECURITY.md). Please report vulnerabilities privately, not in a public issue.

## History

This repo was split out of a combined Solana + Avalanche repo,
[`nirium-multichain`](https://github.com/nirium-protocol/nirium-multichain), on 26 Nov 2026. The
history before that date was kept, so early commits mention both chains. Avalanche lives in
[`nirium-avalanche`](https://github.com/nirium-protocol/nirium-avalanche).

## License

[Apache-2.0](LICENSE)
