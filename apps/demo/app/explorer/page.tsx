import type { Metadata } from "next";
import { Explorer } from "./Explorer";

export const metadata: Metadata = { title: "Receipt explorer · Nirium on Solana" };

export default function ExplorerPage() {
  return <Explorer />;
}
