# nirium-multichain

Nirium receipts for x402 payments on Solana and Avalanche.

A Nirium receipt is a signed statement about a payment: which order it paid and who declared it.
The chain already shows payer, receiver, amount and hash. The receipt adds what the chain does not
keep, and this repo ties that statement to one specific transfer so anyone can check it against the
chain with a public RPC and nothing else.

Status: work in progress, testnet first. Nothing here has had an external audit.

## What is here

| Path | What it does |
|---|---|
| `docs/payment-binding-v1.md` | The receipt format shared by both chains |
| `solana/verify-svm-receipt.mjs` | Checks a receipt against an SPL `TransferChecked` (tx signature + top-level instruction index + Memo) |
| `solana/devnet-demo/` | x402 `exact` payment on Solana with PayAI as facilitator, then writes and signs the receipt |
| `avalanche/verify-evm-receipt.mjs` | Checks a receipt against a USDC `Transfer` log (tx hash + logIndex) and the EIP-3009 `AuthorizationUsed` nonce |
| `avalanche/fuji-demo/` | x402 `exact` payment on Avalanche Fuji with PayAI, then writes and signs the receipt |
| `avalanche/erc8004-fuji/` | Points an ERC-8004 validation request at a receipt (Fuji) |

## Check a receipt

```bash
cd solana && npm ci && node verify-svm-receipt.mjs <receipt.json>
cd avalanche && npm ci && node verify-evm-receipt.mjs <receipt.json>
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input. `--no-sig` skips the signature
check and says so in the output; it is only for testing against third-party transactions.

## Rules this code follows

- Non-custodial: every key belongs to whoever pays or receives. Nirium never holds one.
- Mainnet payments need `NIRIUM_ALLOW_MAINNET=1` on the client. Payments made by the team to test
  the flow are labeled `selftest` and are never counted as usage.
- Receipts are tamper-evident, not tamper-proof: an edited receipt no longer matches its hash or
  its signature.
- Keys never go in this repo. See `.gitignore`.

## License

Apache-2.0
