// Network conditions for a Solana cluster, read from its public RPC. What the x402 market sells.
// Only network facts (priority fees, throughput, slot time, epoch). No token prices, no trading
// language.

export const FEE_PRESSURE_RULE = Object.freeze({
  description: "HIGH when the 75th percentile of recent priority fees is above 10,000 micro-lamports per compute unit. A published heuristic, not a forecast.",
  p75MicroLamports: 10_000,
});

async function rpc(url, method, params = []) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 800 * 2 ** attempt)); continue; }
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
  throw new Error(`${method}: RPC unavailable`);
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

/** Pure: builds the market answer from raw RPC results (testable offline). */
export function summarize({ network, fees, samples, epoch }) {
  const vals = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
  const nonZero = vals.filter((v) => v > 0).length;
  const totalTx = samples.reduce((a, s) => a + (s.numNonVoteTransactions ?? s.numTransactions), 0);
  const totalSecs = samples.reduce((a, s) => a + s.samplePeriodSecs, 0);
  const totalSlots = samples.reduce((a, s) => a + s.numSlots, 0);
  const p75 = pct(vals, 75);
  return {
    network,
    slot: epoch.absoluteSlot,
    epoch: { number: epoch.epoch, progressPct: Math.round((epoch.slotIndex / epoch.slotsInEpoch) * 10_000) / 100 },
    fees: {
      unit: "micro-lamports per compute unit",
      window: { slots: vals.length },
      priorityFee: { p50: pct(vals, 50), p75, p90: pct(vals, 90), max: vals.length ? vals[vals.length - 1] : 0 },
      nonZeroShare: vals.length ? Math.round((nonZero / vals.length) * 10_000) / 10_000 : 0,
    },
    congestion: {
      nonVoteTps: totalSecs ? Math.round((totalTx / totalSecs) * 100) / 100 : null,
      avgSlotTimeMs: totalSlots ? Math.round((totalSecs * 1000) / totalSlots) : null,
      sampleMinutes: Math.round(totalSecs / 60),
    },
    feePressure: p75 > FEE_PRESSURE_RULE.p75MicroLamports ? "HIGH" : "NORMAL",
    feePressureRule: FEE_PRESSURE_RULE.description,
  };
}

/** Reads the cluster at `rpcUrl` and summarizes it. */
export async function readMarket({ rpcUrl, network }) {
  const fees = await rpc(rpcUrl, "getRecentPrioritizationFees", []);
  const samples = await rpc(rpcUrl, "getRecentPerformanceSamples", [10]);
  const epoch = await rpc(rpcUrl, "getEpochInfo", []);
  return { ...summarize({ network, fees, samples, epoch }), asOf: new Date().toISOString(), source: "public RPC: getRecentPrioritizationFees, getRecentPerformanceSamples, getEpochInfo" };
}
