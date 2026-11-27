"use client";
// Receipt explorer: one field, like nirium.xyz/verify. It takes a CID (or a gateway URL), a
// transaction signature, or a receipt pasted or dropped as JSON, says what it detected, and checks
// it in the browser. A CID is fetched from public gateways directly by the browser and its bytes are
// hashed back to the CID before anything is shown. The layout follows the structure of Prova's
// Forensic Explorer (Prova-Solana/Prova, Apache-2.0): one input that detects what was pasted, then a
// detail view. No code or text was copied from it.
import { useEffect, useRef, useState } from "react";
import { usePrefs } from "../Prefs";
import { STORIES } from "@/lib/examples.ts";
import { fetchCid, type Attempt } from "@/lib/ipfs.ts";
import { classify, classifyDoc, verifyReceipt, checkOffline, isChainCheck, reasonKey, FOREIGN_URL, type Verdict } from "@/lib/receipt.ts";
import { DEVNET, MAINNET, NETWORKS, cleanRpcUrl, explorerTxUrl, formatUnits, lookupTransaction, rpcFailureOf, type RpcFailure, type TxView } from "@/lib/chain.ts";
import type { Check } from "nirium-solana/verify";

type Source = { cid: string; gateway: string; cidCheck: boolean | null };
type Result =
  | { kind: "receipt"; network: string; verdict: Verdict; source: Source | null; doc: Record<string, any> }
  | { kind: "partial"; checks: Check[]; source: Source | null }
  | { kind: "tx"; found: TxView[]; mainnetSkipped: boolean; error: RpcFailure | null }
  | { kind: "foreign"; family: "stellar" | "evm"; cid: string | null }
  | { kind: "mismatch"; cid: string; gateway: string }
  | { kind: "not-found"; cid: string; attempts: Attempt[] }
  | { kind: "invalid"; reason: "not-json" | "not-a-receipt" | "unknown-network" | "unrecognized" };

const short = (s: string) => (s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s);
const host = (url: string) => url.replace(/^https:\/\//, "");

export function Explorer() {
  const { lang, t } = usePrefs();
  const [text, setText] = useState("");
  const [rpcText, setRpcText] = useState("");
  const [rpcOpen, setRpcOpen] = useState(false);
  const [busy, setBusy] = useState<null | "fetching" | "checking">(null);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const resultRef = useRef<HTMLElement>(null);
  const rpcUrl = rpcText.trim() ? cleanRpcUrl(rpcText) : null;
  const rpcBad = rpcText.trim() !== "" && !rpcUrl;
  const detected = text.trim() ? classify(text) : null;

  async function checkDoc(doc: any, source: Source | null) {
    const c = classifyDoc(doc);
    if (c.kind === "foreign") return setResult({ kind: "foreign", family: c.family, cid: source?.cid ?? null });
    if (c.kind !== "receipt") return setResult({ kind: "invalid", reason: c.kind === "invalid" ? c.reason : "not-a-receipt" });
    if (c.network === MAINNET && !rpcUrl) { setRpcOpen(true); return setResult({ kind: "partial", checks: checkOffline(c.doc), source }); }
    setBusy("checking");
    // A custom RPC is only for the network it serves; devnet receipts use the public devnet RPC.
    const verdict = await verifyReceipt(c.doc, c.network, c.network === MAINNET ? rpcUrl : null);
    setResult({ kind: "receipt", network: c.network, verdict, source, doc: c.doc });
  }

  async function run(input = text) {
    const c = classify(input);
    setResult(null);
    if (c.kind === "invalid") return setResult({ kind: "invalid", reason: c.reason });
    if (c.kind === "foreign") return setResult({ kind: "foreign", family: c.family, cid: null });
    try {
      if (c.kind === "receipt") return await checkDoc(c.doc, null);
      if (c.kind === "cid") {
        setBusy("fetching");
        const got = await fetchCid(c.cid);
        if (got.status === "mismatch") return setResult({ kind: "mismatch", cid: c.cid, gateway: got.gateway });
        if (got.status === "not-found") return setResult({ kind: "not-found", cid: c.cid, attempts: got.attempts });
        let doc: unknown;
        try { doc = JSON.parse(new TextDecoder().decode(got.bytes)); } catch { return setResult({ kind: "invalid", reason: "not-json" }); }
        return await checkDoc(doc, { cid: c.cid, gateway: got.gateway, cidCheck: got.cidCheck });
      }
      setBusy("checking");
      const found: TxView[] = [];
      let error: RpcFailure | null = null;
      const targets: [string, string][] = [[DEVNET, NETWORKS[DEVNET].rpc]];
      if (rpcUrl) targets.unshift([MAINNET, rpcUrl]);
      for (const [network, url] of targets) {
        try { const v = await lookupTransaction(c.signature, network, url); if (v) found.push(v); }
        catch (e) { error = rpcFailureOf(e) ?? "unreachable"; }
      }
      setResult({ kind: "tx", found, mainnetSkipped: !rpcUrl, error });
    } finally {
      setBusy(null);
    }
  }

  // Shareable: /explorer?cid=Qm… runs once on load.
  useEffect(() => {
    const cid = new URLSearchParams(location.search).get("cid");
    if (cid) { setText(cid); run(cid); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const content = (await file.text()).trim();
    setText(content);
    run(content);
  }

  function open(value: string) {
    setText(value);
    run(value);
    resultRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  return (
    <main className="wrap">
      <section className="hero">
        <p className="badge">{t.eyebrow}</p>
        <h1 className="display">{t.titlePre} <em>{t.titleEm}</em></h1>
        <p className="lead">{t.intro}</p>
      </section>

      <form className="card search" onSubmit={(e) => { e.preventDefault(); run(); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <label className="label" htmlFor="q">{t.inputLabel}</label>
        <div className={`row${dragging ? " over" : ""}`}>
          <input id="q" className="field" type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
            value={text} placeholder={t.placeholder} onChange={(e) => setText(e.target.value)} aria-describedby="q-hint" disabled={!!busy} />
          <button className="btn" type="submit" disabled={!!busy || !text.trim()}>{busy ? t.checking : t.check} <span aria-hidden="true">→</span></button>
        </div>
        <p id="q-hint" className="hint detect" aria-live="polite">{detected ? t.detected[detected.kind === "foreign" ? `foreign-${detected.family}` : detected.kind] : t.drop}</p>
        <details className="rpc" open={rpcOpen} onToggle={(e) => setRpcOpen((e.target as HTMLDetailsElement).open)}>
          <summary>{t.rpcLabel}</summary>
          <input id="rpc" className="field" type="url" inputMode="url" autoComplete="off" value={rpcText} onChange={(e) => setRpcText(e.target.value)} aria-label={t.rpcLabel} aria-invalid={rpcBad} aria-describedby="rpc-hint" placeholder="https://" />
          <p id="rpc-hint" className="hint">{rpcBad ? t.rpcBad : t.rpcHint}</p>
        </details>
      </form>

      <section aria-labelledby="ex-title" className="stories">
        <h2 id="ex-title" className="label">{t.examples}</h2>
        <ul>
          {STORIES.map((s) => (
            <li key={s.cid}>
              <button type="button" className="story" onClick={() => open(s.cid)} disabled={!!busy}>
                <span className="story-title">{s.title[lang]}</span>
                <span className="story-text">{s.text[lang]}</span>
                <span className="story-meta"><span className="tag">{t.selftest}</span><span className="mono">{short(s.cid)}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section ref={resultRef} className="result" aria-live="polite" aria-busy={!!busy}>
        {busy && <div className="card working"><span className="spinner" aria-hidden="true" />{busy === "fetching" ? t.fetching : t.checking}</div>}
        {!busy && result && <ResultView result={result} />}
      </section>
    </main>
  );
}

function SourceLine({ source }: { source: Source | null }) {
  const { t } = usePrefs();
  if (!source) return null;
  const ok = source.cidCheck === true;
  return (
    <p className={`source ${ok ? "pass" : "warn"}`}>
      <Mark ok={ok} /> {ok ? t.cidMatch : t.cidUnchecked} <span className="mono">{short(source.cid)}</span> · {t.servedBy} <span className="mono">{host(source.gateway)}</span>
    </p>
  );
}

function ResultView({ result }: { result: Result }) {
  const { t } = usePrefs();
  if (result.kind === "invalid") return <p className="card note">{t.invalidInput[result.reason]}</p>;
  if (result.kind === "tx") return <TxResult result={result} />;
  if (result.kind === "foreign") {
    const href = result.family === "stellar" && result.cid ? `${FOREIGN_URL.stellar}?cid=${encodeURIComponent(result.cid)}` : result.family === "evm" && result.cid ? `${FOREIGN_URL.evm}?cid=${encodeURIComponent(result.cid)}` : FOREIGN_URL[result.family];
    return <p className="card note">{t.foreign[result.family]} <a href={href}>{t.foreignLink[result.family]} →</a></p>;
  }
  if (result.kind === "mismatch") return <div className="card note bad"><p className="verdict invalid"><Mark ok={false} /> {t.fail}</p><p>{t.mismatch.replace("{gateway}", host(result.gateway)).replace("{cid}", result.cid)}</p></div>;
  if (result.kind === "not-found") return (
    <div className="card note">
      <p>{t.notFound}</p>
      <ul className="attempts mono">{result.attempts.map((a) => <li key={a.gateway}>{host(a.gateway)}: {a.status}</li>)}</ul>
      <pre className="cmd"><code>npx nirium-cli verify {result.cid}</code></pre>
    </div>
  );
  if (result.kind === "partial") return (
    <div>
      <SourceLine source={result.source} />
      <p className="verdict incomplete"><Mark ok={null} /> {t.partial}</p>
      <p>{t.partialLead}</p>
      <CheckGroup title={t.groupReceipt} checks={result.checks} />
      <div className="card note"><p>{t.needsRpc}</p><pre className="cmd"><code>npx nirium-verify-svm receipt.json</code></pre></div>
    </div>
  );
  const v = result.verdict;
  if (v.status === "needs-rpc") return null;
  if (v.status === "rpc-error") return <p className="card note warn">{t.rpcError[v.failure]}</p>;
  if (v.status === "bad-input") return <p className="card note">{t.badInput} <span className="mono">{v.message}</span></p>;
  const label = v.status === "valid" ? t.valid : v.status === "invalid" ? t.invalid : t.incomplete;
  const lead = v.status === "incomplete" ? `${t.incompleteLead} ${t.rpcError[v.failure]}` : v.status === "valid" ? t.validLead : t.invalidLead;
  return (
    <div>
      <SourceLine source={result.source} />
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
      {result.error && <p className="card note warn">{t.rpcError[result.error]}</p>}
      {result.mainnetSkipped && <p className="card note">{t.txMainnetSkipped}</p>}
      {!result.found.length && !result.error && <p className="card note">{t.txNotFound}</p>}
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

export function Mark({ ok }: { ok: boolean | null }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
      {ok === null ? <path d="M3 7h8" stroke="currentColor" strokeWidth="2" /> : ok ? <path d="M2.5 7.5 5.5 10.5 11.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" /> : <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}
