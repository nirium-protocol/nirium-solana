// One-click examples: the team's own test payments from evidence/, imported as they are so the
// page never shows a copy that drifted. Each one is labeled as a team self-test in the UI.
import devnet from "../../../evidence/2026-11-26/solana-devnet-binding.json";
import devnetPolicy from "../../../evidence/2026-11-26/solana-devnet-policy-allow-binding.json";
import devnetSdk from "../../../evidence/2026-11-26/solana-devnet-sdk-binding.json";
import devnetMarket from "../../../evidence/2026-11-27/solana-devnet-market-fly-binding.json";
import mainnet from "../../../evidence/2026-11-26/solana-mainnet-binding.json";
import mainnetMarket from "../../../evidence/2026-11-27/solana-mainnet-market-binding.json";

export const EXAMPLES = [
  { id: "devnet", label: { en: "Devnet payment", es: "Pago en devnet" }, doc: devnet },
  { id: "devnet-policy", label: { en: "Devnet, after a policy ALLOW", es: "Devnet, tras un ALLOW de la política" }, doc: devnetPolicy },
  { id: "devnet-sdk", label: { en: "Devnet, paid with the library", es: "Devnet, pagado con la librería" }, doc: devnetSdk },
  { id: "devnet-market", label: { en: "Devnet, market query", es: "Devnet, consulta al market" }, doc: devnetMarket },
  { id: "mainnet", label: { en: "Mainnet payment", es: "Pago en mainnet" }, doc: mainnet },
  { id: "mainnet-market", label: { en: "Mainnet, market query", es: "Mainnet, consulta al market" }, doc: mainnetMarket },
] as const;
