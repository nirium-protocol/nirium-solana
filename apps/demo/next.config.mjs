import { fileURLToPath } from "node:url";

// The repo root, so the app can import the package from ../../solana (file: link, the code of
// this same commit) and the team's receipts from ../../evidence.
const root = fileURLToPath(new URL("../..", import.meta.url));

// The demo lives at nirium.xyz/solana: nirium.xyz rewrites /solana/* to this deployment, so every
// path here starts with /solana. The old address (solana.nirium.xyz/ and /explorer) redirects there.
/** @type {import("next").NextConfig} */
export default {
  basePath: "/solana",
  async redirects() {
    return [
      { source: "/", destination: "https://nirium.xyz/solana", permanent: false, basePath: false },
      { source: "/explorer", destination: "https://nirium.xyz/solana/explorer", permanent: false, basePath: false },
    ];
  },
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};
