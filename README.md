# nirium-solana

Nirium receipts for x402 payments on Solana.

A Nirium receipt is a signed statement about a payment: which order it paid and who declared it.
The chain already shows payer, receiver, amount and signature. The receipt adds what the chain
does not keep, and this repo ties that statement to one specific SPL transfer so anyone can check
it against Solana with a public RPC and nothing else.

Status: work in progress, devnet first. Nothing here has had an external audit.

## What is here

| Path | What it does |
|---|---|
| `docs/payment-binding-v1.md` | The receipt format |
| `solana/verify-svm-receipt.mjs` | Checks a receipt against an SPL `TransferChecked`: tx signature, top-level instruction index, Memo |
| `solana/devnet-demo/` | x402 `exact` payment on Solana with PayAI as facilitator, then writes and signs the receipt |
| `scripts/` | Devnet key setup and the payTo token account |
| `evidence/` | Payments made by the team to test the flow, with their receipts |

## Check a receipt

```bash
cd solana && npm ci && node verify-svm-receipt.mjs <receipt.json>
```

Exit code 0 means valid, 1 means a check failed, 2 means bad input. `--no-sig` skips the signature
check and says so in the output; it is only for testing against third-party transactions.

## Run the tests

```bash
cd solana && npm ci && node test-live.mjs        # 21 cases, Solana mainnet and devnet
```

The suite checks real public transactions over public RPC, so it needs network access. The
fixtures point at third-party payments and are labeled as such. They test the verifier; they are
not usage of this project.

## Devnet keys

```bash
bash scripts/new-testnet-keys.sh          # payer and payTo keypairs in ~/.nirium-keys (mode 600)
bash scripts/solana-devnet-prep-payto.sh  # gives the payTo its devnet USDC token account
```

The first script prints addresses only and refuses to overwrite keys or to write inside the repo.
Fund the payer with devnet USDC at faucet.circle.com (it has a captcha, so it is done by hand).
Mainnet keys are never made by a script here.

## Rules this code follows

- Non-custodial: every key belongs to whoever pays or receives. Nirium never holds one.
- Mainnet payments need `NIRIUM_ALLOW_MAINNET=1` on the client. Payments made by the team to test
  the flow are labeled `selftest` and are never counted as usage.
- Receipts are tamper-evident, not tamper-proof: an edited receipt no longer matches its hash or
  its signature.
- Keys never go in this repo. See `.gitignore`.

## History

This repo was split out of a combined Solana + Avalanche repo on 26-nov-2026. The history before
that date was kept, so commits that mention both chains come from that period.

## License

Apache-2.0
