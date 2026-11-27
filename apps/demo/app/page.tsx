"use client";
import Link from "next/link";
import { usePrefs } from "./Prefs";

// The paid demo lands here in a later PR.
export default function Home() {
  const { t } = usePrefs();
  return (
    <main className="wrap">
      <h1>{t.homeTitle}</h1>
      <p className="lead">{t.homeLead}</p>
      <p><Link href="/explorer">{t.openExplorer} →</Link></p>
    </main>
  );
}
