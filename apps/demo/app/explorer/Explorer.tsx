"use client";
// Receipt explorer. The layout follows the structure of Prova's Forensic Explorer
// (Prova-Solana/Prova, Apache-2.0): one input that detects what was pasted, then a detail view.
// No code or text was copied from it.
import { useState } from "react";
import { usePrefs } from "../Prefs";
import { EXAMPLES } from "@/lib/examples.ts";
import { classify, verifyReceipt, isChainCheck, reasonKey, type Verdict } from "@/lib/receipt.ts";
import { DEVNET, MAINNET, NETWORKS, cleanRpcUrl, explorerTxUrl, formatUnits, lookupTransaction, rpcFailureOf, type RpcFailure, type TxView } from "@/lib/chain.ts";
import type { Check } from "nirium-solana/verify";

type Result =
  | { kind: "receipt"; network: string; verdict: Verdict }
  | { kind: "tx"; found: TxView[]; mainnetSkipped: boolean; error: RpcFailure | null }
  | { kind: "invalid"; reason: "not-json" | "not-a-receipt" | "unknown-network" | "unrecognized" };

const short = (s: string) => (s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s);

export function Explorer() {
  const { lang, t } = usePrefs();
  const [text, setText] = useState("");
  const [rpcText, setRpcText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const rpcUrl = rpcText.trim() ? cleanRpcUrl(rpcText) : null;
  const rpcBad = rpcText.trim() !== "" && !rpcUrl;

  async function run(input = text) {
    const c = classify(input);
    if (c.kind === "invalid") return setResult({ kind: "invalid", reason: c.reason });
    setBusy(true);
    setResult(null);
    try {
      if (c.kind === "receipt") {
        // A custom RPC is only for the network it serves; devnet receipts use the public devnet RPC.
        const custom = c.network === MAINNET ? rpcUrl : null;
        setResult({ kind: "receipt", network: c.network, verdict: await verifyReceipt(c.doc, c.network, custom) });
      } else {
        const found: TxView[] = [];
        let error: RpcFailure | null = null;
        const targets: [string, string][] = [[DEVNET, NETWORKS[DEVNET].rpc]];
        if (rpcUrl) targets.unshift([MAINNET, rpcUrl]);
        for (const [network, url] of targets) {
          try { const v = await lookupTransaction(c.signature, network, url); if (v) found.push(v); }
          catch (e) { error = rpcFailureOf(e) ?? "unreachable"; }
        }
        setResult({ kind: "tx", found, mainnetSkipped: !rpcUrl, error });
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
    run(content);
  }

  return (
    <main className="wrap">
      <p className="eyebrow">{t.eyebrow}</p>
      <h1>{t.title}</h1>
      <p className="lead">{t.intro}</p>

      <form className="panel" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label htmlFor="input">{t.inputLabel}</label>
        <div className={`drop${dragging ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <textarea id="input" className="mono" rows={8} spellCheck={false} value={text} placeholder={t.placeholder} onChange={(e) => setText(e.target.value)} aria-describedby="drop-hint" />
          <span id="drop-hint" className="hint">{t.drop}</span>
        </div>
        <label htmlFor="rpc">{t.rpcLabel}</label>
        <input id="rpc" className="mono" type="url" inputMode="url" autoComplete="off" value={rpcText} onChange={(e) => setRpcText(e.target.value)} aria-invalid={rpcBad} aria-describedby="rpc-hint" placeholder="https://" />
        <span id="rpc-hint" className="hint">{rpcBad ? t.rpcBad : t.rpcHint}</span>
        <button className="primary" type="submit" disabled={busy || !text.trim()}>{busy ? t.checking : t.check}</button>
      </form>

      <section aria-labelledby="ex-title" className="examples">
        <h2 id="ex-title">{t.examples}</h2>
        <ul>
          {EXAMPLES.map((ex) => (
            <li key={ex.id}>
              <button type="button" onClick={() => { const s = JSON.stringify(ex.doc, null, 2); setText(s); run(s); }}>
                {ex.label[lang]} <span className="tag">{t.selftest}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="result" aria-live="polite" aria-busy={busy}>
        {busy && <div className="skeleton" aria-hidden="true" />}
        {busy && <p className="sr">{t.checking}</p>}
        {result && <ResultView result={result} />}
      </section>
    </main>
  );
}

function ResultView({ result }: { result: Result }) {
  const { t } = usePrefs();
  if (result.kind === "invalid") return <p className="note">{t.invalidInput[result.reason]}</p>;
  if (result.kind === "tx") return <TxResult result={result} />;
  const v = result.verdict;
  if (v.status === "needs-rpc") return <div className="note"><p>{t.needsRpc}</p><pre className="mono">npx nirium-verify-svm receipt.json</pre></div>;
  if (v.status === "rpc-error") return <p className="note warn">{t.rpcError[v.failure]}</p>;
  if (v.status === "bad-input") return <p className="note">{t.badInput} <span className="mono">{v.message}</span></p>;
  const label = v.status === "valid" ? t.valid : v.status === "invalid" ? t.invalid : t.incomplete;
  const lead = v.status === "incomplete" ? `${t.incompleteLead} ${t.rpcError[v.failure]}` : v.status === "valid" ? t.validLead : t.invalidLead;
  return (
    <div>
      <p className={`verdict ${v.status}`}><Mark ok={v.status === "valid"} /> {label} <span className="net">{NETWORKS[result.network].name}</span></p>
      <p>{lead}</p>
      <CheckGroup title={t.groupReceipt} checks={v.checks.filter((c) => !isChainCheck(c.name))} />
      <CheckGroup title={t.groupChain} checks={v.checks.filter((c) => isChainCheck(c.name))} />
    </div>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: Check[] }) {
  const { t } = usePrefs();
  if (!checks.length) return null;
  return (
    <section className="group">
      <h3>{title}</h3>
      <ol className="checks">
        {checks.map((c, i) => {
          const why = !c.ok && reasonKey(c.name);
          return (
            <li key={i} className={c.ok ? "pass" : "fail"}>
              <span className="state"><Mark ok={c.ok} /> {c.ok ? t.pass : t.fail}</span>
              <span className="mono name">{c.name}</span>
              {why && <span className="why">{t.reasons[why]}</span>}
              {c.detail && <span className="mono detail">{c.detail}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TxResult({ result }: { result: Extract<Result, { kind: "tx" }> }) {
  const { lang, t } = usePrefs();
  return (
    <div>
      {result.error && <p className="note warn">{t.rpcError[result.error]}</p>}
      {result.mainnetSkipped && <p className="note">{t.txMainnetSkipped}</p>}
      {!result.found.length && !result.error && <p className="note">{t.txNotFound}</p>}
      {result.found.map((v) => (
        <article key={v.network} className="group">
          <h3>{t.txTitle} <span className="net">{t.txOn} {NETWORKS[v.network].name}</span></h3>
          <p>{t.txLead}</p>
          {v.failed && <p className="note warn">{t.txFailed}</p>}
          {!v.transfers.length && <p className="note">{t.txNone}</p>}
          <dl className="facts mono">
            <dt>{t.txSlot}</dt><dd>{v.slot}</dd>
            <dt>{t.txTime}</dt><dd>{v.blockTime ? new Date(v.blockTime * 1000).toLocaleString(lang) : "n/a"}</dd>
            {v.memos.flatMap((m, i) => [<dt key={`mt${i}`}>{t.txMemo}</dt>, <dd key={`md${i}`}>{m}</dd>])}
          </dl>
          {v.transfers.map((x) => (
            <dl key={x.index} className="facts mono transfer">
              <dt>{t.instruction}</dt><dd>{x.index}</dd>
              <dt>{t.txFrom}</dt><dd title={x.from}>{short(x.from)}</dd>
              <dt>{t.txTo}</dt><dd title={x.to ?? ""}>{x.to ? short(x.to) : t.unknownOwner}</dd>
              <dt>{t.txAmount}</dt><dd>{formatUnits(x.amount, x.decimals)} {x.usdc ? "USDC" : x.mint ? short(x.mint) : ""}</dd>
            </dl>
          ))}
          <a href={explorerTxUrl(v.signature, v.network)} target="_blank" rel="noreferrer">{t.explorerLink}</a>
        </article>
      ))}
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="mark-icon">
      {ok ? <path d="M2.5 7.5 5.5 10.5 11.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" /> : <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}
