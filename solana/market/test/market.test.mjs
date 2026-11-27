// Tests for the Solana x402 market. Offline: the summary is computed from fixed RPC results; the
// paid flow runs against a fake RPC (mint, payTo token account, blockhash) and a fake facilitator;
// the data reader is stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSigner } from "@solana/kit";
import { createX402Fetch, settlementOf, DEVNET } from "nirium-solana";
import { associatedTokenAddress } from "nirium-solana-policy";
import { summarize } from "../data.mjs";
import { createMarketApp } from "../server.mjs";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

test("summarize: priority fee percentiles, throughput, slot time, epoch and fee pressure", () => {
  const fees = Array.from({ length: 100 }, (_, i) => ({ slot: i, prioritizationFee: i < 50 ? 0 : i * 100 }));
  const samples = [{ numSlots: 150, numTransactions: 6000, numNonVoteTransactions: 3000, samplePeriodSecs: 60 }, { numSlots: 150, numTransactions: 6000, numNonVoteTransactions: 3000, samplePeriodSecs: 60 }];
  const epoch = { absoluteSlot: 1000, epoch: 7, slotIndex: 216000, slotsInEpoch: 432000 };
  const s = summarize({ network: DEVNET, fees, samples, epoch });
  assert.equal(s.fees.priorityFee.p50, 5000);
  assert.equal(s.fees.priorityFee.p75, 7500);
  assert.equal(s.fees.nonZeroShare, 0.5);
  assert.equal(s.congestion.nonVoteTps, 50);
  assert.equal(s.congestion.avgSlotTimeMs, 400);
  assert.equal(s.epoch.progressPct, 50);
  assert.equal(s.feePressure, "NORMAL");
  const busy = summarize({ network: DEVNET, fees: fees.map((f) => ({ ...f, prioritizationFee: 20_000 })), samples, epoch });
  assert.equal(busy.feePressure, "HIGH");
  for (const k of Object.keys(busy)) assert.doesNotMatch(k, /price(?!s)|opportunit|arbitrage|signal/i);
});

test("the market refuses mainnet unless allowed explicitly", async () => {
  const payTo = (await generateKeyPairSigner()).address;
  assert.throws(() => createMarketApp({ payTo, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }), /mainnet/);
});

test("info is free, the data is paid, and a paid query returns the network conditions", async () => {
  const payer = await generateKeyPairSigner();
  const payTo = (await generateKeyPairSigner()).address;
  const feePayer = (await generateKeyPairSigner()).address;
  const blockhash = (await generateKeyPairSigner()).address;
  const ata = String(await associatedTokenAddress(payTo, USDC, TOKEN));
  const listen = async (s) => { await new Promise((r) => s.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${s.address().port}`; };
  const rpc = createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => {
      const m = JSON.parse(b); let result = null;
      if (m.method === "getAccountInfo" && m.params[0] === USDC) { const d = Buffer.alloc(82); d[44] = 6; d[45] = 1; result = { context: { slot: 1 }, value: { data: [d.toString("base64"), "base64"], executable: false, lamports: 1, owner: TOKEN, rentEpoch: 0, space: 82 } }; }
      else if (m.method === "getAccountInfo" && m.params[0] === ata) result = { context: { slot: 1 }, value: { data: [Buffer.alloc(165).toString("base64"), "base64"], executable: false, lamports: 1, owner: TOKEN, rentEpoch: 0, space: 165 } };
      else if (m.method === "getLatestBlockhash") result = { context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 100 } };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...(result ? { result } : { error: { code: -32601, message: m.method } }) }));
    });
  });
  let settled = 0;
  const fac = createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url.endsWith("/supported")) return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: DEVNET, extra: { feePayer, transactionVersions: [0, 1] } }], extensions: [], signers: { "solana:*": [feePayer] } }));
      if (req.url.endsWith("/verify")) return res.end(JSON.stringify({ isValid: true, payer: payer.address }));
      settled++; res.end(JSON.stringify({ success: true, transaction: "6".repeat(87), network: DEVNET, payer: payer.address }));
    });
  });
  const rpcUrl = await listen(rpc);
  const facUrl = await listen(fac);
  const app = createMarketApp({ payTo, facilitatorUrl: facUrl, rpcUrl, read: async () => ({ network: DEVNET, feePressure: "NORMAL" }) });
  const srv = createServer(app);
  const base = await listen(srv);
  try {
    const info = await (await fetch(`${base}/v1/market/info`)).json();
    assert.equal(info.price, "$0.01");
    assert.equal((await fetch(`${base}/v1/market`)).status, 402);
    const pay = createX402Fetch({ signer: payer, network: DEVNET, maxAmountPerPayment: "10000", rpcUrl });
    const res = await pay(`${base}/v1/market`, { headers: { "X-Nirium-Ref": "market-test-1" } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { network: DEVNET, feePressure: "NORMAL" });
    assert.equal(settled, 1);
    assert.ok(settlementOf(res));
  } finally { srv.close(); fac.close(); rpc.close(); }
});
