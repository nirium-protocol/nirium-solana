// Tier A gets 451 on every path of this demo (see lib/geo.ts). Vercel sets x-vercel-ip-country from the
// connecting IP. Requests rewritten from nirium.xyz were already checked there.
import { NextResponse, type NextRequest } from "next/server";
import { isTierA, POLICY_URL } from "./lib/geo.ts";

export function proxy(request: NextRequest) {
  const country = request.headers.get("x-vercel-ip-country");
  if (!isTierA(country)) return NextResponse.next();
  return NextResponse.json(
    {
      error: "unavailable_for_legal_reasons",
      message: "Nirium does not offer any service in your jurisdiction.",
      jurisdiction: country,
      policy: POLICY_URL,
      contact: "niriumprotocol@gmail.com",
    },
    { status: 451, headers: { "X-Restricted-Jurisdiction": String(country) } },
  );
}
