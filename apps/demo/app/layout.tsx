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
