# Evidence

Every payment here was made by the team to test the flow. They are labeled `selftest` and are
**not usage**. The mainnet payment used a cent from the team's own funds. Each receipt can be
checked by anyone with the verifier and a public RPC:

```bash
cd solana && npm ci && node verify-svm-receipt.mjs ../evidence/2026-11-26/solana-devnet-binding.json
cd solana && npm ci && node verify-svm-receipt.mjs ../evidence/2026-11-26/solana-mainnet-binding.json
```

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-26 15:00 | Solana devnet | [`2uyixpix…bWwj`](https://explorer.solana.com/tx/2uyixpix6haUfxhzRfMNkFJJaTxngKJ7WNqMLLRQL4vee6MzME5Jwmrg82p7gdbfDq1ds6hw7Lq9tiEL5foZbWwj?cluster=devnet) | top-level ix 2, tx v0, Memo = order ref | 0.01 USDC | `2026-11-26/solana-devnet-binding.json` | VALID, payer-signed |
| 2026-11-27 02:22 | **Solana mainnet** | [`mqmFD1ht…om3`](https://explorer.solana.com/tx/mqmFD1htyEEDByPM1YEVMuN7pKPo14qadSzobqCijv38o6nQUx4K8cgVQxjeBbuMaB27kd1B8sSqeRu8MwCdom3) | top-level ix 2, tx v0, Memo = order ref | 0.01 USDC | `2026-11-26/solana-mainnet-binding.json` | VALID, payer-signed |

Both were x402 `exact` payments settled by the PayAI facilitator. On mainnet, PayAI was the fee
payer, so the payer needed no SOL; balances read on-chain moved payer 0.50 → 0.49 USDC and payTo
0.05 → 0.06 USDC. The order reference was set as the x402 `extra.memo`, so it is written on-chain
in the Memo instruction next to the transfer. The devnet receipt was also checked against altered
copies of itself (amount, instruction index, receiver, memo, an edited `purpose`, an altered
signature): every altered copy failed for the expected reason.

## Pre-sign policy on devnet

Three runs of `solana/policy/demo-pay.mjs` against the same 0.01 USDC resource, through PayAI on
devnet. The payer's USDC balance was read on-chain before and after each run.

| Policy | Outcome | Signed | Sent to the seller | Payer balance (USDC) |
|---|---|---|---|---|
| max 5000 | DENY ("amount 10000 above limit 5000") | no | no | 19.99 → 19.99 |
| max 20000, approval above 5000 | WAIT ("needs approval") | no | no | 19.99 → 19.99 |
| max 10000, payTo allowlisted | ALLOWED, SIGNED | yes | yes: [`4mPSGLf2…KQtv`](https://explorer.solana.com/tx/4mPSGLf258vyCxkTB9xx7ZjJB1NJurwXy4pHh6LAzzmLNGCo15RACkNq4ExmYdzzcTFLeyTmZwxdx4cFNKiBKQtv?cluster=devnet) | 19.99 → 19.98 |

The ALLOW payment has its own payer-signed receipt, `2026-11-26/solana-devnet-policy-allow-binding.json`,
VALID. A refused payment leaves nothing on-chain by design: nothing was signed.

## SDK on devnet

`solana/sdk/examples/selftest.mjs` in one run: a seller charging with `x402Serve`, a buyer paying
with `createX402Fetch` under a rules policy that only allows PayAI's published fee payers (ALLOWED,
SIGNED), the order ref sent as `X-Nirium-Ref` and written on-chain as the Memo, PayAI settling, and
a payer-signed receipt from `bindReceipt` checked with `verifyReceipt`.

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-27 | Solana devnet | [`hfwT3Fqp…Bn7`](https://explorer.solana.com/tx/hfwT3FqpmG5qfA2GkBVT2EbEHfjoFLidwrXPwSm1M6vMmT71K4M24q3VS4zXmCVbPPY1NAWA7JqLL7Ma8asBAn7?cluster=devnet) | top-level ix 2, tx v0, Memo = `selftest-2026-11-26-sol-sdk-01` | 0.01 USDC | `2026-11-26/solana-devnet-sdk-binding.json` | VALID, payer-signed (27 checks) |

## x402 market

One paid query to the Solana market (`solana/market`) on devnet, bought with the SDK under a
policy that only allows PayAI's published fee payers (ALLOWED, SIGNED), with the order ref written
on-chain as the Memo and a payer-signed receipt.

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-27 | Solana devnet | [`3H338d41…Puv2`](https://explorer.solana.com/tx/3H338d41hPn5zTRc8N8G8H84QJiXGCpUFEWizZSCaZ8jyuXAqnZ2XjNZjrdGuBDaqT23S35LqqiBz28TPAMyPuv2?cluster=devnet) | top-level ix 2, tx v0, Memo = `selftest-2026-11-26-sol-market-01` | 0.01 USDC | `2026-11-26/solana-devnet-market-binding.json` | VALID, payer-signed (27 checks) |

Team self-test with test tokens. The market is devnet-only; on mainnet each sale would be income.

## x402 market on Fly (testnet, then mainnet)

The market runs on Fly at [`https://nirium-market-solana.fly.dev`](https://nirium-market-solana.fly.dev/v1/market/info). First a paid query on
testnet through the public URL, then the config switched to mainnet with a payTo created for the
market only (`AD4aGC5SEe7ZMXB36TtvuL52WgNSYHnokEhWh4GUGF9m`) and one purchase made by the team. The mainnet purchase was made from
`Gm3XXXKx…oBG` (team self-test wallet) with the **published npm package** (`nirium-solana@0.1.0`), under a policy that only
allowed this payTo and at most 0.01 USDC (ALLOWED, SIGNED). The market's payTo balance read
on-chain went 0.02 → 0.03 USDC.

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-27 | Solana devnet | [`5VUzeCmw…8wUn`](https://explorer.solana.com/tx/5VUzeCmwqvfTuyuB6gTR1UKh7XbpS5erCgH3SminfmepUDE6ngYoTkXVZfmC5e96TwaJDqZZc43oWepqvQme8wUn?cluster=devnet) | top-level ix 2, tx v0, Memo = `selftest-2026-11-27-sol-market-fly-01` | 0.01 USDC | `2026-11-27/solana-devnet-market-fly-binding.json` | VALID, payer-signed (27 checks) |
| 2026-11-27 | **Solana mainnet** | [`5wTXAGK7…5RrQ`](https://explorer.solana.com/tx/5wTXAGK7svVMLznSCFQeaZsLvdqZVDr2mTW63XKA6kpmhxbXcYVFQrS2gwHfv8HhARnkbyJmMP2uDwAAsx6p5RrQ) | top-level ix 2, tx v0, Memo = `selftest-2026-11-27-sol-market-mainnet-01` | 0.01 USDC | `2026-11-27/solana-mainnet-market-binding.json` | VALID, payer-signed (27 checks) |

Both are team self-tests: the mainnet sale was paid with team funds and is **not** a customer
sale or usage. From now on, a sale to this payTo from anyone else is income for Nirium.
