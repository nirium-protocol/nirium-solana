import type { Metadata, Viewport } from "next";
import { Inter, Inconsolata } from "next/font/google";
import { Prefs } from "./Prefs";
import "./globals.css";

// Same typefaces as nirium.xyz: Inter for text, Inconsolata for data, hashes and addresses.
// Inter in both styles: the display titles are 900 italic, like nirium.xyz.
const inter = Inter({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-inter" });
const inconsolata = Inconsolata({ subsets: ["latin"], variable: "--font-inconsolata" });

export const metadata: Metadata = {
  title: "Nirium on Solana",
  description: "A receipt signed by whoever pays, that anyone can check against Solana, in the browser.",
  icons: { icon: "/solana/icon.svg" }, // basePath is not added to metadata icons
  robots: { index: false, follow: false },
  // Link previews (Telegram, X, Slack, WhatsApp). Absolute URLs: basePath is not added to metadata
  // images, and nirium.xyz rewrites /solana/* to this deployment, so /solana/og.png is served from public/og.png.
  metadataBase: new URL("https://nirium.xyz"),
  openGraph: {
    type: "website",
    siteName: "Nirium",
    url: "https://nirium.xyz/solana",
    title: "Nirium on Solana",
    description: "A receipt signed by whoever pays, that anyone can check against Solana, in the browser.",
    images: [{ url: "https://nirium.xyz/solana/og.png", width: 1200, height: 630, alt: "Nirium on Solana: a receipt signed by whoever pays, checked against Solana in the browser" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nirium on Solana",
    description: "A receipt signed by whoever pays, that anyone can check against Solana, in the browser.",
    images: ["https://nirium.xyz/solana/og.png"],
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Sets the theme before paint, from the visitor's choice or their system setting.
const themeScript = `(function(){try{var t=localStorage.getItem('nirium-demo-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className={`${inter.variable} ${inconsolata.variable}`}>
        <Prefs>{children}</Prefs>
      </body>
    </html>
  );
}
