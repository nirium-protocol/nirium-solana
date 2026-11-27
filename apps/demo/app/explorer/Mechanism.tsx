"use client";
// The result drawn as the mechanism: the receipt on the left, the transfer on the chain on the
// right, and a wire for each thing that must match. Each wire says PASS or FAIL in words and, when
// it breaks, why. The visitor can edit the receipt and watch the wires that depend on that field
// break, with the same verifier re-run on the chain answers already read.
import { usePrefs } from "../Prefs";
import type { Link, Edit } from "@/lib/mechanism.ts";
import { reasonKey } from "@/lib/receipt.ts";

export function Mechanism({ links, network, purpose, edits, onEdit, rechecking }: {
  links: Link[]; network: string; purpose: string | null; edits: Edit[]; onEdit: (e: Edit | null) => void; rechecking: boolean;
}) {
  const { t } = usePrefs();
  const m = t.mech;
  return (
    <section className="mech" aria-labelledby="mech-title">
      <h3 id="mech-title" className="sr">{m.title}</h3>
      <div className="mech-board">
      <div className="mech-heads" aria-hidden="true">
        <p><span className="label">{m.receiptHead}</span><span className="mech-sub">{m.receiptSub}</span></p>
        <span />
        <p><span className="label">{m.chainHead.replace("{network}", network)}</span><span className="mech-sub">{m.chainSub}</span></p>
      </div>
      {purpose && (
        <div className="wire-row purpose-row">
          <p className="side left"><span className="side-label">{m.purpose}</span><span className="side-value">{purpose}</span></p>
          <span aria-hidden="true" />
          <p className="side right"><span className="side-label">{m.purpose}</span><span className="purpose-chain">{m.purposeChain}</span></p>
        </div>
      )}
      <ol className="wires">
        {links.map((l, i) => {
          const why = l.failed ? reasonKey(l.failed) : null;
          return (
            <li key={l.key} className={`wire-row ${l.ok ? "pass" : "fail"}`} style={{ ["--i" as string]: i }}>
              <span className="sr">{m.srRow.replace("{what}", m.links[l.key]).replace("{receipt}", l.receipt).replace("{chain}", l.chain ?? m.none).replace("{state}", l.ok ? t.pass : t.fail)}</span>
              <div className="side left" aria-hidden="true"><span className="side-label">{m.links[l.key]}</span><span className="mono side-value">{l.receipt}</span></div>
              <div className="wire" aria-hidden="true">
                <svg viewBox="0 0 120 24" preserveAspectRatio="none" focusable="false">
                  {l.ok
                    ? <path className="w-line" d="M4 12H116" />
                    : <><path className="w-line" d="M4 12H50" /><path className="w-line" d="M70 12H116" /><path className="w-gap" d="M53 5l5 14M62 5l5 14" /></>}
                  <circle cx="4" cy="12" r="3.5" /><circle cx="116" cy="12" r="3.5" />
                </svg>
                <span className="w-badge">{l.ok ? t.pass : t.fail}</span>
              </div>
              <div className="side right" aria-hidden="true"><span className="side-label">{m.chainLinks[l.key]}</span><span className="mono side-value">{l.chain ?? m.none}</span></div>
              {!l.ok && <p className="wire-why">{why ? t.reasons[why] : m.notChecked}</p>}
            </li>
          );
        })}
      </ol>
      </div>
      <fieldset className="edits">
        <legend className="label">{m.editTitle}</legend>
        <p className="hint">{m.editHint}</p>
        <div className="edit-buttons">
          {(["amount", "destination", "purpose"] as const).map((e) => (
            <button key={e} type="button" className="btn ghost small-btn" aria-pressed={edits.includes(e)} disabled={rechecking} onClick={() => onEdit(e)}>{m.edit[e]}</button>
          ))}
          {edits.length > 0 && <button type="button" className="btn small-btn" disabled={rechecking} onClick={() => onEdit(null)}>{m.restore}</button>}
        </div>
      </fieldset>
    </section>
  );
}
