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
