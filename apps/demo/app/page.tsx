"use client";
import Link from "next/link";
import pkg from "nirium-solana/package.json";
import { usePrefs } from "./Prefs";

const REPO = "https://github.com/nirium-protocol/nirium-solana";
const MARKET = "https://nirium-market-solana.fly.dev/v1/market/info";

// The entry page: what Nirium on Solana is, and what already exists, each with an honest state.
export default function Home() {
  const { t } = usePrefs();
  const h = t.homePage;
  return (
    <main className="wrap wide">
      <section className="hero">
        <p className="badge">{h.badge}</p>
        <h1 className="display">{h.titlePre} <em>Solana</em></h1>
        <p className="lead">{h.lead}</p>
        <div className="ctas">
          <Link className="btn" href="/explorer">{h.verifyCta} <span aria-hidden="true">→</span></Link>
          <a className="btn ghost" href={REPO} target="_blank" rel="noreferrer">{h.repoCta}</a>
        </div>
      </section>

      <h2 className="label">{h.existsTitle}</h2>
      <ul className="tiles">
        <li className="card tile">
          <p className="state-pill live">{h.live}</p>
          <h3 className="tile-title">{h.verifyTitle}</h3>
          <p>{h.verifyText}</p>
          <Link href="/explorer">{h.verifyLink} →</Link>
        </li>
        <li className="card tile">
          <p className="state-pill live">{h.charging}</p>
          <h3 className="tile-title">{h.marketTitle}</h3>
          <p>{h.marketText}</p>
          <p className="mono small">{h.marketSales}</p>
          <a href={MARKET} target="_blank" rel="noreferrer" className="mono small">/v1/market/info ↗</a>
        </li>
        <li className="card tile">
          <p className="state-pill live">npm · {pkg.version}</p>
          <h3 className="tile-title">{h.libraryTitle}</h3>
          <p>{h.libraryText}</p>
          <pre className="cmd"><code>npm install nirium-solana</code></pre>
          <a href="https://www.npmjs.com/package/nirium-solana" target="_blank" rel="noreferrer">npmjs.com ↗</a>
        </li>
        <li className="card tile soon">
          <p className="state-pill">{h.soon}</p>
          <h3 className="tile-title">{h.payTitle}</h3>
          <p>{h.payText}</p>
        </li>
      </ul>
    </main>
  );
}
