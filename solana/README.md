# nirium-solana

Pay and charge with x402 on Solana, refuse a payment before it is signed, and keep a
payer-signed receipt bound to the exact SPL `TransferChecked`.

The chain already shows who paid whom, how much and when. The receipt adds what the chain does
not keep: which order the payment was for and who declared it. Anyone can check it against
Solana with a public RPC. Part of [Nirium](https://nirium.xyz). Source, tests and the team's
test payments: [nirium-solana](https://github.com/nirium-protocol/nirium-solana).

```bash
npm install nirium-solana
```

```js
import { x402Serve, createX402Fetch, settlementOf, bindReceipt, verifyReceipt, createRulesPolicy, DEVNET } from "nirium-solana";

// Charge for your own API. Runs on your server: Nirium runs nothing in the middle.
app.use(x402Serve({ payTo: "<your wallet>", network: DEVNET, routes: { "GET /data": "$0.01" } }));

// Pay, with a policy: a payment it refuses is never signed.
const pay = createX402Fetch({ signer, network: DEVNET, maxAmountPerPayment: "10000",
  policy: createRulesPolicy({ maxAmount: "10000" }) });
const res = await pay("https://seller.example/data", { headers: { "X-Nirium-Ref": "order-42" } });

// A payer-signed receipt bound to the transfer, and its check against the chain.
const receipt = await bindReceipt({ tx: settlementOf(res).transaction, network: DEVNET, ref: "order-42", signer });
const { ok } = await verifyReceipt(receipt);
```

`signer` is a `@solana/kit` signer for the payer's own key. Networks: Solana devnet and mainnet (mainnet needs `allowMainnet: true`). `x402Serve` needs `express` (4.22.3+ or 5.3.0+) in your
app. Settlement is done by PayAI, an independent x402 facilitator.

| Import | What it is |
|---|---|
| `nirium-solana` | `x402Serve`, `createX402Fetch`, `settlementOf`, `bindReceipt`, `verifyReceipt`, `createRulesPolicy` |
| `nirium-solana/policy` | The pre-sign policy gate (decodes what is about to be signed, asks your policy, signs only on a bound ALLOW) |
| `nirium-solana/policy/rules` | A small reference policy engine: max amount, approval line, allowlists |
| `nirium-solana/receipt` | `bindReceipt` and `verifyReceipt` on their own, without the Express middleware |
| `nirium-solana/decision` | Decision receipts: `bindDecision`, `verifyDecision`, `collectDecisions` (also exported from `nirium-solana`) |
| `nirium-solana/verify` | The receipt verifier as a library. No Node-only code, so it runs in Node and in the browser |

Check a receipt from the command line:

```bash
npx -p nirium-solana nirium-verify-svm receipt.json
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input.

Receipts are tamper-evident, not tamper-proof, and they do not prove that goods or a service
were delivered. Non-custodial: every key stays with whoever pays or receives. No external audit
yet. Report security problems privately: [SECURITY.md](https://github.com/nirium-protocol/nirium-solana/blob/main/SECURITY.md).

License: Apache-2.0
