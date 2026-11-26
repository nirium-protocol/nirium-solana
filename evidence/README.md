# Evidence

Every payment here was made by the team to test the flow. They are labeled `selftest` and are
**not usage**. Each receipt can be checked by anyone with the verifier and a public RPC:

```bash
cd solana && npm ci && node verify-svm-receipt.mjs ../evidence/2026-11-26/solana-devnet-s2-binding.json
```

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-26 15:00 | Solana devnet | [`2uyixpix…bWwj`](https://explorer.solana.com/tx/2uyixpix6haUfxhzRfMNkFJJaTxngKJ7WNqMLLRQL4vee6MzME5Jwmrg82p7gdbfDq1ds6hw7Lq9tiEL5foZbWwj?cluster=devnet) | top-level ix 2, tx v0, Memo = order ref | 0.01 USDC | `2026-11-26/solana-devnet-s2-binding.json` | VALID, payer-signed |

An x402 `exact` payment settled by the PayAI facilitator. The order reference was set as the
x402 `extra.memo`, so it is written on-chain in the Memo instruction next to the transfer. The
receipt was also checked against altered copies of itself (amount, instruction index, receiver,
memo, an edited `purpose`, an altered signature): every altered copy failed for the expected
reason.

Mainnet: pending.
