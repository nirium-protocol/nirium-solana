# Evidence

Every payment here was made by the team to test the flow. They are labeled `selftest` and are
**not usage**. Each receipt can be checked by anyone with the verifier and a public RPC:

```bash
cd solana && npm ci && node verify-svm-receipt.mjs ../evidence/2026-11-26/solana-devnet-s2-binding.json
cd avalanche && npm ci && node verify-evm-receipt.mjs ../evidence/2026-11-26/fuji-a2-binding.json
```

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-26 14:59 | Avalanche Fuji (`eip155:43113`) | [`0x7ca309a4…29f9`](https://testnet.snowtrace.io/tx/0x7ca309a41b019393d2d9e77ec89aff54a2d644b37657b8f2eaa93331cc6429f9) | logIndex 1 (block 61670610) | 0.01 USDC | `2026-11-26/fuji-a2-binding.json` | VALID, payer-signed |
| 2026-11-26 15:00 | Solana devnet | [`2uyixpix…bWwj`](https://explorer.solana.com/tx/2uyixpix6haUfxhzRfMNkFJJaTxngKJ7WNqMLLRQL4vee6MzME5Jwmrg82p7gdbfDq1ds6hw7Lq9tiEL5foZbWwj?cluster=devnet) | top-level ix 2, tx v0, Memo = order ref | 0.01 USDC | `2026-11-26/solana-devnet-s2-binding.json` | VALID, payer-signed |

Both were x402 `exact` payments settled by the PayAI facilitator. Each receipt was also checked
against altered copies of itself (amount, locator, receiver, nonce or memo, an edited
`purpose`, an altered signature): every altered copy failed for the expected reason.
