# nirium-solana

Nirium on Solana: pay and charge with x402, refuse payments before they are signed, and prove
what a payment was for.

```js
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy, DEVNET } from "nirium-solana";

// Charge for your own API (runs on your server; Nirium runs nothing and receives nothing)
app.use(x402Serve({ payTo: "<wallet>", network: DEVNET, routes: { "GET /data": "$0.01" } }));

// Pay, with a policy: a payment it refuses is never signed
const pay = createX402Fetch({ signer, network: DEVNET, maxAmountPerPayment: "10000", policy: createRulesPolicy({ maxAmount: "10000" }) });
const res = await pay("https://seller.example/data", { headers: { "X-Nirium-Ref": "order-42" } });

// Prove what it was for: a payer-signed receipt bound to the exact SPL transfer
const receipt = await bindReceipt({ tx: settlementOf(res).transaction, network: DEVNET, ref: "order-42", signer });
const { ok } = await verifyReceipt(receipt);
```

| Function | What it does |
|---|---|
| `x402Serve(config)` | Express middleware. Prices in dollars or atomic units. The `X-Nirium-Ref` request header becomes the on-chain Memo (deterministic, so the paid retry matches; malformed refs get 400). PayAI by default (an independent facilitator that also pays the network fee). Before the first paid request it checks the facilitator supports the network and that `payTo` already has its USDC token account; if not, paid routes answer 503 with a hint and the rest of the app keeps serving. No telemetry. |
| `createX402Fetch(cfg)` | `fetch` that pays x402 `exact` with a per-payment cap, v0 transactions only (registered by hand). With `policy`, nothing is signed without the policy's ALLOW (see `../policy/`), and the cap still applies. Mainnet needs `allowMainnet: true`. |
| `settlementOf(res)` | The settlement from the `PAYMENT-RESPONSE` header, or `undefined`. |
| `bindReceipt(o)` | Waits for the tx to be finalized, finds the top-level `TransferChecked` and the Memo, builds the receipt in canonical order and signs it with the payer's `@solana/kit` message signer. Refuses a signer that is not the transfer authority. |
| `verifyReceipt(doc)` | The chain verifier (`../verify-svm-core.mjs`), the same code the CLI and the browser run. |

The receipt adds what the chain does not keep: who declared the payment and what it was for. It
does not prove delivery. Format: `../../docs/payment-binding-v1.md`.

## Tests

```bash
cd .. && npm ci && npm run test:sdk   # 8 tests
```

The pay/charge loop runs offline: a fake RPC answers the mint, the payTo's token account and the
blockhash, and a fake facilitator decodes the transaction it receives, checks the payer's ed25519
signature, and checks the transfer and memo with the same decoder the policy gate uses. Covered:
paid end to end with the order ref as the Memo, a malformed ref, the cap, a policy DENY (alone and
under the cap), a policy ALLOW, a payTo without its token account and a facilitator outage. The
receipt test rebuilds one of the team's real devnet receipts from the chain over the public RPC.

`examples/selftest.mjs` runs the whole thing live on devnet through PayAI (team self-test, test
tokens). See `../../evidence/README.md`.
