// Tier A of Nirium's Restricted Jurisdictions & Sanctions Policy (nirium.xyz/legal/restricted-jurisdictions-v1.md,
// §2): no access to any Nirium service, paid or free. The market sells data for USDC, so it must not sell
// it there. Same countries and the same geoip-lite data as the Nirium node (packages/agent, 27-nov-2026).
// Tier B (EEA, UK, US) is not restricted here: the policy only closes Payouts and Treasury there.
// /health stays open for Fly's checks. An unknown country passes: IP geolocation is imperfect, as §7 says.

import geoip from "geoip-lite";

export const TIER_A_COUNTRIES = new Set([
  "CU", "IR", "KP", "SY", // comprehensive sanctions
  "AF", "MM",             // FATF call for action / high risk
  "RU", "BY",             // prudential restriction, pending review
  "CN",                   // PBoC 2021, extraterritorial reach
]);

const POLICY_URL = "https://nirium.xyz/legal/restricted-jurisdictions-v1.md";

/** Express middleware. `lookup` is injectable for tests. */
export function blockTierA(lookup = (ip) => geoip.lookup(ip)?.country ?? null) {
  return (req, res, next) => {
    if (req.path === "/health") return next();
    let country = null;
    try { country = lookup(req.ip); } catch { country = null; }
    if (country && TIER_A_COUNTRIES.has(country)) {
      return res.status(451).set("X-Restricted-Jurisdiction", country).json({
        error: "unavailable_for_legal_reasons",
        message: "Nirium does not offer any service in your jurisdiction.",
        jurisdiction: country,
        policy: POLICY_URL,
        contact: "niriumprotocol@gmail.com",
      });
    }
    next();
  };
}
