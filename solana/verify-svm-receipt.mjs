#!/usr/bin/env node
// verify-svm-receipt.mjs - command line for the Solana receipt verifier.
//
// Usage:
//   node verify-svm-receipt.mjs <binding.json> [--no-sig] [--rpc <url>] [--json]
//
// Every check lives in verify-svm-core.mjs, the same file verifyReceipt() and the browser run.
// This file only reads the receipt, prints the checks and sets the exit code:
// 0 = every check passed, 1 = at least one failed (or not finalized yet), 2 = bad input.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyBinding } from "./verify-svm-core.mjs";

export * from "./verify-svm-core.mjs";

async function main() {
  const args = process.argv.slice(2);
  const rpcIdx = args.indexOf("--rpc");
  // (rpcIdx < 0 guard: without --rpc, rpcIdx + 1 == 0 would skip a file given first.)
  const file = args.find((a, i) => !a.startsWith("--") && (rpcIdx < 0 || i !== rpcIdx + 1));
  if (!file) { console.error("usage: node verify-svm-receipt.mjs <binding.json> [--no-sig] [--rpc url] [--json]"); process.exit(2); }
  const opts = { requireSig: !args.includes("--no-sig"), rpc: rpcIdx >= 0 ? args[rpcIdx + 1] : undefined };
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`bad binding file: ${e.message}`); process.exit(2); }
  let res;
  try { res = await verifyBinding(doc, opts); } catch (e) { console.error(`bad input: ${e.message}`); process.exit(2); }
  if (args.includes("--json")) console.log(JSON.stringify(res, null, 2));
  else {
    for (const c of res.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  [" + c.detail + "]" : ""}`);
    console.log(res.ok ? "RESULT: VALID" : "RESULT: INVALID");
  }
  process.exit(res.ok ? 0 : 1);
}

// Run main() when executed directly, including through the npm bin symlink: compare real paths,
// or a symlinked call would skip main() and exit 0 without checking anything.
const invokedPath = (() => { try { return realpathSync(process.argv[1]); } catch { return undefined; } })();
if (invokedPath && realpathSync(fileURLToPath(import.meta.url)) === invokedPath) main();
