import type { Metadata } from "next";
import { Explorer } from "./Explorer";

// Its own link preview: a child openGraph replaces the layout's, so the image is listed again.
export const metadata: Metadata = {
  title: "Receipt explorer · Nirium on Solana",
  openGraph: {
    type: "website",
    siteName: "Nirium",
    url: "https://nirium.xyz/solana/explorer",
    title: "Receipt explorer · Nirium on Solana",
    description: "Paste a receipt's CID and check it against Solana, in your browser.",
    images: [{ url: "https://nirium.xyz/solana/og.png", width: 1200, height: 630, alt: "Nirium on Solana: a receipt signed by whoever pays, checked against Solana in the browser" }],
  },
  twitter: { card: "summary_large_image", title: "Receipt explorer · Nirium on Solana", description: "Paste a receipt's CID and check it against Solana, in your browser.", images: ["https://nirium.xyz/solana/og.png"] },
};

export default function ExplorerPage() {
  return <Explorer />;
}
