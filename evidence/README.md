# Evidence

Every payment here was made by the team to test the flow. They are labeled `selftest` and are
**not usage**. Mainnet payments used a few cents from the team's own funds. Each receipt can be
checked by anyone with the verifier and a public RPC:

```bash
cd solana && npm ci && node verify-svm-receipt.mjs ../evidence/2026-11-26/solana-devnet-s2-binding.json
cd avalanche && npm ci && node verify-evm-receipt.mjs ../evidence/2026-11-26/fuji-a2-binding.json
cd avalanche && npm ci && node verify-evm-receipt.mjs ../evidence/2026-11-26/cchain-a3-binding.json
```

## Payments

| Date (UTC) | Network | Transaction | Locator | Amount | Receipt | Verifier |
|---|---|---|---|---|---|---|
| 2026-11-26 14:59 | Avalanche Fuji (`eip155:43113`) | [`0x7ca309a4…29f9`](https://testnet.snowtrace.io/tx/0x7ca309a41b019393d2d9e77ec89aff54a2d644b37657b8f2eaa93331cc6429f9) | logIndex 1 (block 61670610) | 0.01 USDC | `2026-11-26/fuji-a2-binding.json` | VALID, payer-signed |
| 2026-11-26 15:00 | Solana devnet | [`2uyixpix…bWwj`](https://explorer.solana.com/tx/2uyixpix6haUfxhzRfMNkFJJaTxngKJ7WNqMLLRQL4vee6MzME5Jwmrg82p7gdbfDq1ds6hw7Lq9tiEL5foZbWwj?cluster=devnet) | top-level ix 2, tx v0, Memo = order ref | 0.01 USDC | `2026-11-26/solana-devnet-s2-binding.json` | VALID, payer-signed |
| 2026-11-26 15:32 | **Avalanche C-Chain mainnet** (`eip155:43114`) | [`0x9b718e42…3f83`](https://snowtrace.io/tx/0x9b718e4249efea418291da2cb4169dcfc344e0b1794d2a2937c7fa08dc4d3f83) | logIndex 12 (block 101457077) | 0.01 USDC | `2026-11-26/cchain-a3-binding.json` | VALID, payer-signed |

All three were x402 `exact` payments settled by the PayAI facilitator. The C-Chain one was
settled by a PayAI relayer through Multicall3, so the transaction's `to` is not the USDC
contract: the receipt is bound to the specific `Transfer` log, which is why the locator is a log
index. The testnet receipts were also checked against altered copies of themselves (amount,
locator, receiver, nonce or memo, an edited `purpose`, an altered signature): every altered copy
failed for the expected reason.

## ERC-8004 on Avalanche Fuji

The Fuji receipt above was put through the ERC-8004 validation flow on Fuji:

| Step | Transaction | Result |
|---|---|---|
| `register` (agent card `2026-11-26/fuji-agent-card.json`) | [`0xd91c19b3…1e43`](https://testnet.snowtrace.io/tx/0xd91c19b316e1663d1949b917d92039685ae6b13a93d73bac0927b08aa8b21e43) | agentId 368 |
| `validationRequest` pointing at the receipt | [`0x59de4635…36dc`](https://testnet.snowtrace.io/tx/0x59de463597b207102865f6233dd522257aa7bee116e3609c8c98b728dcb736dc) | requestHash `0xb4a812b5…e3e1` = keccak256 of the receipt file's bytes |
| `validationResponse` by the validator | [`0x7dc27e71…4a58`](https://testnet.snowtrace.io/tx/0x7dc27e71afb3d801b596bcc76ce51c41b3aebdba6cf9ed3ac5a7280e1da44a58) | response 100, tag `nirium-payment-binding-v1`, review `2026-11-26/fuji-a2-validation-review.json` |

The URIs point at this repo pinned to commit `9321ce8`, so their content cannot change; the
request and response hashes bind the exact bytes. The validator is the payTo key, which is also a
team key: this shows the ERC-8004 mechanics, not an independent third-party validation.
