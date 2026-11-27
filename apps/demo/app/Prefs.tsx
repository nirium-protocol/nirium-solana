"use client";
// Language and theme, kept in the visitor's own localStorage (never sent anywhere).
import { createContext, useContext, useEffect, useState } from "react";
import { STRINGS, type Lang, type Strings } from "@/lib/i18n.ts";

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
  return (
    <Ctx.Provider value={{ lang, t }}>
      <div className="banner" role="note">{t.banner}</div>
      <header className="bar">
        <a className="mark" href="/">nirium<span> · solana</span></a>
        <div className="toggles">
          <div role="group" aria-label={t.langLabel}>
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => pickLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
          <div role="group" aria-label={t.themeLabel}>
            {(["light", "dark"] as const).map((th) => (
              <button key={th} type="button" aria-pressed={theme === th} onClick={() => pickTheme(th)}>{t[th]}</button>
            ))}
          </div>
        </div>
      </header>
      {children}
      <footer className="foot">{t.footer}</footer>
    </Ctx.Provider>
  );
}
