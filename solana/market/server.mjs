// Nirium x402 market for Solana: sells this cluster's network conditions for $0.01 per query,
// paid with x402 through an independent facilitator (PayAI). The buyer pays Nirium's payTo
// directly; the market stores nothing about buyers (no addresses, no logs of who paid).
//
// Test networks only for now (devnet). On mainnet every sale would be income for Nirium: that is a
// separate decision, so the server refuses mainnet unless NIRIUM_MARKET_ALLOW_MAINNET=1.
//
//   PAY_TO=<wallet> node server.mjs        # PORT (4023), NETWORK, FACILITATOR_URL, DATA_RPC_URL

import express from "express";
import { pathToFileURL } from "node:url";
import { x402Serve, getNetwork, PAYAI_FACILITATOR, DEVNET } from "nirium-solana";
import { readMarket, FEE_PRESSURE_RULE } from "./data.mjs";

export function createMarketApp({ payTo, network = DEVNET, price = "$0.01", facilitatorUrl, rpcUrl, dataRpcUrl, allowMainnet = false, read = readMarket }) {
  const net = getNetwork(network);
  if (net.mainnet && !allowMainnet) throw new Error("market: refusing mainnet (every sale would be income); set allowMainnet explicitly");
  const dataUrl = dataRpcUrl || net.rpc;
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (req, res) => res.json({ ok: true }));
  app.get("/v1/market/info", (req, res) => res.json({
    what: "Network conditions of this Solana cluster: recent priority fees, non-vote throughput, slot time, epoch progress.",
    network, price, payTo, paidWith: "x402 exact, USDC, settled by an independent facilitator that also pays the network fee",
    facilitator: facilitatorUrl || PAYAI_FACILITATOR,
    orderReference: "send X-Nirium-Ref to have it written on-chain as the payment's Memo",
    source: "the cluster's public RPC, read at request time",
    feePressureRule: FEE_PRESSURE_RULE.description,
    notes: ["Network data only. No token prices and no recommendation to transact.", "Nothing about the buyer is stored.", "Test network: test tokens only."],
  }));
  app.use(x402Serve({ payTo, network, facilitatorUrl, rpcUrl, routes: { "GET /v1/market": { price, description: "Solana network conditions" } } }));
  app.get("/v1/market", async (req, res) => {
    try { res.json(await read({ rpcUrl: dataUrl, network })); }
    catch (e) { res.status(502).json({ error: "could not read the chain right now", detail: String(e.message).slice(0, 160) }); }
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createMarketApp({
    payTo: process.env.PAY_TO,
    network: process.env.NETWORK || DEVNET,
    facilitatorUrl: process.env.FACILITATOR_URL,
    dataRpcUrl: process.env.DATA_RPC_URL,
    allowMainnet: process.env.NIRIUM_MARKET_ALLOW_MAINNET === "1",
  });
  const port = Number(process.env.PORT || 4023);
  app.listen(port, () => console.log(`nirium market on http://localhost:${port}/v1/market (info: /v1/market/info)`));
}
