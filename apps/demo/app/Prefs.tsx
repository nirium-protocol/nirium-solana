"use client";
// Language and theme, kept in the visitor's own localStorage (never sent anywhere), and the chrome
// every page shares: the status bar, the header with the N, and the footer.
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import pkg from "nirium-solana/package.json";
import { STRINGS, type Lang, type Strings } from "@/lib/i18n.ts";
import { Logo } from "./Logo";

type Theme = "light" | "dark";
const Ctx = createContext<{ lang: Lang; t: Strings }>({ lang: "en", t: STRINGS.en });
export const usePrefs = () => useContext(Ctx);

export function Prefs({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>("en");
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const l = localStorage.getItem("nirium-demo-lang");
    setLang(l === "es" || l === "en" ? l : navigator.language.startsWith("es") ? "es" : "en");
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const pickLang = (l: Lang) => { setLang(l); localStorage.setItem("nirium-demo-lang", l); };
  const pickTheme = (th: Theme) => { setTheme(th); document.documentElement.dataset.theme = th; localStorage.setItem("nirium-demo-theme", th); };
  const t = STRINGS[lang];
  const facts: [string, string][] = [
    [t.status.checks, t.status.checksValue],
    [t.status.stored, t.status.storedValue],
    [t.status.networks, "devnet · mainnet"],
    [t.status.library, `nirium-solana ${pkg.version}`],
  ];
  return (
    <Ctx.Provider value={{ lang, t }}>
      <a className="sr" href="#main">{t.skip}</a>
      <dl className="status" aria-label={t.status.label}>
        <div><span className="dot" aria-hidden="true" /><dt>{t.status.demo}</dt><dd>{t.status.demoValue}</dd></div>
        {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <header className="bar">
        <Link className="brand" href="/" aria-label={t.home}>
          <Logo /><b>NIRIUM</b><span className="chip">Solana</span>
        </Link>
        <div className="toggles">
          <div role="group" aria-label={t.langLabel}>
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => pickLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
          <button type="button" className="theme" aria-label={theme === "dark" ? t.toLight : t.toDark} title={theme === "dark" ? t.toLight : t.toDark} onClick={() => pickTheme(theme === "dark" ? "light" : "dark")}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {theme === "dark"
                ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
                : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
            </svg>
          </button>
        </div>
      </header>
      <div id="main">{children}</div>
      <footer className="foot">{t.footer}</footer>
    </Ctx.Provider>
  );
}
