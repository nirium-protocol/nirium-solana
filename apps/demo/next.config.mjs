import { fileURLToPath } from "node:url";

// The repo root, so the app can import the package from ../../solana (file: link, the code of
// this same commit) and the team's receipts from ../../evidence.
const root = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import("next").NextConfig} */
export default {
  turbopack: { root },
  outputFileTracingRoot: root,
  poweredByHeader: false,
};
