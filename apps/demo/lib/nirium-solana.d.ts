// Types for the parts of the nirium-solana package (plain .mjs) this app uses.
declare module "nirium-solana/verify" {
  export type Check = { name: string; ok: boolean; detail: string };
  export function verifyBinding(doc: unknown, opts?: { requireSig?: boolean; rpc?: string }): Promise<{ ok: boolean; checks: Check[] }>;
  export function contentSha256(record: unknown): string;
  export const VERSION: string;
  export const STATEMENT_PREFIX: string;
  export function ed25519Valid(keyBase58: string, message: string, signatureBase64: string): boolean;
}
