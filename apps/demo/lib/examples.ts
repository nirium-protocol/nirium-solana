// Examples as stories: receipts the team anchored on Nirium's Audit Trail, opened by CID so they go
// through the same gateway fetch and CID recomputation as anything a visitor pastes. All of them are
// the team's own test payments and are labeled that way on the page.
export const STORIES = [
  {
    cid: "Qme4Cwz5suiYQ5bRKjQqvxFdtRWwDQSbE5m2ZxLNq8Vuhg",
    title: { en: "The first payment on Solana mainnet", es: "El primer pago en Solana mainnet" },
    text: {
      en: "0.01 USDC on 27 Nov 2026 (UTC), the order reference written on chain as the Memo. Without your own mainnet RPC, the page shows what it can check and says what is missing.",
      es: "0.01 USDC el 27 nov 2026 (UTC), con la referencia de la orden escrita en la cadena como Memo. Sin tu propio RPC de mainnet, la página muestra lo que puede comprobar y dice qué falta.",
    },
  },
  {
    cid: "QmWMvQ8pcAGs2fojuZvUzxj68VvZfdYYpbR8gqL6j9cCi6",
    title: { en: "A payment on devnet, checked end to end", es: "Un pago en devnet, comprobado de punta a punta" },
    text: {
      en: "The same kind of receipt on devnet, where the public RPC answers browsers: every check runs, including the ones against the chain.",
      es: "El mismo tipo de recibo en devnet, donde el RPC público sí responde al navegador: corren todas las comprobaciones, también las de la cadena.",
    },
  },
  {
    cid: "QmNjcqmY3xCnHfpvj8KXj9ZhKFEzyrMmXEQ8jNfBkhpZMz",
    title: { en: "A receipt from another network", es: "Un recibo de otra red" },
    text: {
      en: "A payment on Avalanche Fuji. This page recognizes it and sends you to the page that checks Avalanche.",
      es: "Un pago en Avalanche Fuji. Esta página lo reconoce y te manda a la que comprueba Avalanche.",
    },
  },
] as const;
