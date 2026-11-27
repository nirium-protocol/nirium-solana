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
    cid: "QmXmmVHWqGHDCgp6WLQCienWqkA16CyKf5dKP84EhTtFLA",
    title: { en: "A sale of the x402 market", es: "Una venta del market x402" },
    text: {
      en: "A $0.01 query to Nirium's x402 market for Solana network data, on devnet. The payer signed this receipt for that exact transfer, with the order reference as the Memo.",
      es: "Una consulta de $0.01 al market x402 de Nirium por datos de la red de Solana, en devnet. Quien pagó firmó este recibo para esa transferencia exacta, con la referencia de la orden como Memo.",
    },
  },
  {
    cid: "QmT4qw5QpF2ffB2o1BQcpbGQDG8gRuu7bzDJqFhPU1VUkb",
    title: { en: "A payment that never happened", es: "Un pago que nunca ocurrió" },
    text: {
      en: "The payer's policy refused a $0.01 payment on devnet before signing it: above its $0.005 limit. Nothing reached the chain; this receipt, signed by the payer, is the record of the attempt.",
      es: "La política de quien paga rechazó un pago de $0.01 en devnet antes de firmarlo: pasaba su límite de $0.005. Nada llegó a la cadena; este recibo, firmado por quien paga, es el registro del intento.",
    },
  },
  {
    cid: "QmWccVYqxr7SUrZiaF5RQur6og8eBirKnGYrXivD9d25w3",
    title: { en: "A payment held for a person", es: "Un pago retenido para que lo apruebe una persona" },
    text: {
      en: "The same $0.01 on devnet, held before signing because anything above $0.005 needs a person's approval. Nothing was signed while it waited.",
      es: "Los mismos $0.01 en devnet, retenidos antes de firmar porque todo lo que pase de $0.005 necesita que lo apruebe una persona. Mientras esperaba no se firmó nada.",
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
    cid: "QmWMvQ8pcAGs2fojuZvUzxj68VvZfdYYpbR8gqL6j9cCi6",
    edit: "amount",
    title: { en: "An edited receipt", es: "Un recibo editado" },
    text: {
      en: "The devnet receipt with its amount changed in this page after it was signed. Watch which links break, and why.",
      es: "El recibo de devnet con el monto cambiado en esta página después de firmarse. Mira qué líneas se rompen, y por qué.",
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
