// Sanity checks for the tamper vectors: re-encoding the real message unchanged must give the
// same bytes and pass the gate, so a D-vector failure comes from its own change, not from the
// re-encoding. Also prints why each tampered message is refused.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSigner, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder } from "@solana/kit";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { describeAuthorization, associatedTokenAddress } from "../svm-policy.mjs";

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const USDC_DEV = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
let rpc, url, payer, req;

before(async () => {
  rpc = createServer((r, s) => { let b = ""; r.on("data", (c) => { b += c; }); r.on("end", () => {
    const m = JSON.parse(b); const d = Buffer.alloc(82); d[44] = 6; d[45] = 1;
    s.writeHead(200, { "content-type": "application/json" });
    s.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { context: { slot: 1 }, value: { data: [d.toString("base64"), "base64"], executable: false, lamports: 1, owner: TOKEN, rentEpoch: 0, space: 82 } } }));
  }); });
  await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${rpc.address().port}`;
  payer = await generateKeyPairSigner();
  req = { scheme: "exact", network: DEVNET, asset: USDC_DEV, payTo: (await generateKeyPairSigner()).address, amount: "10000", maxTimeoutSeconds: 120,
    extra: { feePayer: (await generateKeyPairSigner()).address, memo: "order-42", recentBlockhash: (await generateKeyPairSigner()).address } };
});
after(() => rpc.close());

test("the real message re-encoded unchanged is byte-identical and passes the gate's checks", async () => {
  let bytes;
  const capture = { address: payer.address, signTransactions: async (t, c) => { bytes = t[0].messageBytes; return payer.signTransactions(t, c); } };
  await new ExactSvmScheme(capture, { transactionVersions: [0], rpcUrl: url }).createPaymentPayload(2, { ...req });
  const re = new Uint8Array(getCompiledTransactionMessageEncoder().encode(getCompiledTransactionMessageDecoder().decode(bytes)));
  assert.deepEqual(re, new Uint8Array(bytes));
  const a = await describeAuthorization(re, req, payer.address);
  assert.equal(a.amount, "10000");
  assert.equal(a.destinationAta, String(await associatedTokenAddress(req.payTo, USDC_DEV, TOKEN)));

  // One representative change per check family, with the reason it is refused.
  const reasons = {};
  const tamper = async (name, f) => {
    const m = structuredClone(getCompiledTransactionMessageDecoder().decode(bytes)); f(m);
    try { await describeAuthorization(new Uint8Array(getCompiledTransactionMessageEncoder().encode(m)), req, payer.address); reasons[name] = "NOT REFUSED"; }
    catch (e) { reasons[name] = e.message.replace("x402 policy CONTEXT_MISMATCH: ", ""); }
  };
  await tamper("amount", (m) => { m.instructions[2].data = Uint8Array.from([12, 0x11, 0x27, 0, 0, 0, 0, 0, 0, 6]); });
  await tamper("decimals", (m) => { const d = Uint8Array.from(m.instructions[2].data); d[9] = 9; m.instructions[2].data = d; });
  await tamper("authority", (m) => { m.instructions[2].accountIndices = [...m.instructions[2].accountIndices.slice(0, 3), 0]; });
  await tamper("memo", (m) => { m.instructions[3].data = new TextEncoder().encode("order-43"); });
  await tamper("cu price", (m) => { m.instructions[1].data = Uint8Array.from([3, 0, 0, 0, 0, 1, 0, 0, 0]); });
  await tamper("signers", (m) => { m.header.numSignerAccounts = 3; });
  console.log(JSON.stringify(reasons, null, 2));
  for (const [k, v] of Object.entries(reasons)) assert.notEqual(v, "NOT REFUSED", k);
});
