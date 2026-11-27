// Tier A of Nirium's Restricted Jurisdictions & Sanctions Policy (nirium.xyz/legal/restricted-jurisdictions-v1.md,
// §2): no access to any Nirium service, paid or free. nirium.xyz already blocks it before rewriting to this demo;
// this covers direct visits to the demo's own domains. Same countries as the site, the node and the markets.
export const TIER_A_COUNTRIES = new Set(["CU", "IR", "KP", "SY", "AF", "MM", "RU", "BY", "CN"]);

export const POLICY_URL = "https://nirium.xyz/legal/restricted-jurisdictions-v1.md";

/** True only for a known Tier A country. Unknown passes: IP geolocation is imperfect (policy §7). */
export function isTierA(country: string | null | undefined): boolean {
  return !!country && TIER_A_COUNTRIES.has(country.toUpperCase());
}
