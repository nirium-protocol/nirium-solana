export type Lang = "en" | "es";

const en = {
  banner: "Devnet demo. Test tokens only.",
  langLabel: "Language",
  themeLabel: "Theme",
  light: "Light",
  dark: "Dark",
  homeTitle: "Nirium receipts on Solana devnet.",
  homeLead: "A payer-signed receipt says what an x402 payment was for, and anyone can check it against the chain.",
  footer: "A receipt shows who declared a payment and what it was for. It does not show that goods or a service were delivered.",
};

const es: typeof en = {
  banner: "Demo en devnet. Solo tokens de prueba.",
  langLabel: "Idioma",
  themeLabel: "Tema",
  light: "Claro",
  dark: "Oscuro",
  homeTitle: "Recibos de Nirium en devnet de Solana.",
  homeLead: "Un recibo firmado por quien paga dice para qué fue un pago x402, y cualquiera puede comprobarlo contra la cadena.",
  footer: "Un recibo muestra quién declaró un pago y para qué fue. No muestra que se entregaron bienes o un servicio.",
};

export const STRINGS = { en, es };
export type Strings = typeof en;
