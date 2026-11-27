"use client";
import { usePrefs } from "./Prefs";

// The receipt explorer and the paid demo land in the next PRs.
export default function Home() {
  const { t } = usePrefs();
  return (
    <main className="wrap">
      <h1>{t.homeTitle}</h1>
      <p className="lead">{t.homeLead}</p>
    </main>
  );
}
