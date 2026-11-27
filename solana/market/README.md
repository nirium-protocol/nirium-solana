# Nirium x402 market (Solana)

Network conditions of a Solana cluster for $0.01 per query, paid with x402.

| Route | Paid | What |
|---|---|---|
| `GET /v1/market` | $0.01 (USDC, x402 `exact`) | Recent priority fees (p50/p75/p90/max in micro-lamports per compute unit, and the share that is non-zero), non-vote throughput, average slot time, epoch progress, and `feePressure` (HIGH or NORMAL) with its published rule |
| `GET /v1/market/info` | free | What is sold, price, network, payTo, facilitator, data source |
| `GET /health` | free | |

- Data comes from the cluster's public RPC at request time (`getRecentPrioritizationFees`,
  `getRecentPerformanceSamples`, `getEpochInfo`). Network data only: no token prices and no
  recommendation to transact.
- Payment goes from the buyer straight to the market's `payTo`, settled by an independent
  facilitator (PayAI) that also pays the network fee. Send `X-Nirium-Ref` and it is written
  on-chain as the payment's Memo. The market stores nothing about buyers.
- Devnet only for now. On mainnet each sale is income for Nirium, so the server refuses mainnet
  unless `NIRIUM_MARKET_ALLOW_MAINNET=1`.

```bash
(cd .. && npm ci)   # the market uses the nirium-solana package from the folder above
npm ci
PAY_TO=<wallet> node server.mjs                                             # port 4023
NIRIUM_PAYER_KEYPAIR=<path> node buy.mjs --payto <wallet> --ref order-1     # buys one query, writes a receipt
npm test                                                                    # 3 tests, offline
```

`buy.mjs` uses the SDK with a policy (only PayAI's published fee payers allowed), so the buyer only
signs what the policy allows, and it leaves a payer-signed receipt bound to the payment.
