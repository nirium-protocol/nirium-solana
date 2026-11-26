#!/usr/bin/env bash
# Creates fresh TESTNET keys for this project, outside the repo, readable only by you.
#   Solana devnet: payer and payTo keypair files (solana-keygen).
#   Avalanche Fuji: payer, payTo and agent-owner keys in one env file (viem).
# Prints addresses only, never a secret. Refuses to overwrite existing keys.
# Mainnet keys are NOT made here: make them by hand and fund them with cents.
set -euo pipefail
umask 077
REPO="$(cd "$(dirname "$0")/.." && pwd)"
KEYDIR="${NIRIUM_KEY_DIR:-$HOME/.nirium-keys}"
case "$KEYDIR" in "$REPO"*) echo "refusing: key dir is inside the repo ($KEYDIR)"; exit 2;; esac
mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"

SOL_PAYER="$KEYDIR/sol-devnet-payer.json"
SOL_PAYTO="$KEYDIR/sol-devnet-payto.json"
EVM_ENV="$KEYDIR/fuji.env"
for f in "$SOL_PAYER" "$SOL_PAYTO" "$EVM_ENV"; do
  if [ -e "$f" ]; then echo "refusing: $f already exists (delete it yourself if you mean it)"; exit 2; fi
done

command -v solana-keygen >/dev/null || { echo "solana-keygen not found"; exit 2; }
solana-keygen new --no-bip39-passphrase --silent --outfile "$SOL_PAYER" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --outfile "$SOL_PAYTO" >/dev/null
chmod 600 "$SOL_PAYER" "$SOL_PAYTO"

[ -d "$REPO/avalanche/fuji-demo/node_modules/viem" ] || (cd "$REPO/avalanche/fuji-demo" && npm ci --silent --no-audit --no-fund)
(cd "$REPO/avalanche/fuji-demo" && node --input-type=module -e "
import { generatePrivateKey, privateKeyToAccount } from \"viem/accounts\";
import { writeFileSync } from \"node:fs\";
const payer = generatePrivateKey(), payto = generatePrivateKey(), agent = generatePrivateKey();
const addr = (k) => privateKeyToAccount(k).address;
writeFileSync(process.argv[1], [
  \"# Avalanche Fuji TESTNET keys for nirium-multichain. Never commit, never paste.\",
  \"NIRIUM_EVM_PAYER_KEY=\" + payer,
  \"NIRIUM_EVM_PAYTO=\" + addr(payto),
  \"NIRIUM_EVM_VALIDATOR_KEY=\" + payto,
  \"NIRIUM_EVM_AGENT_KEY=\" + agent,
  \"\"].join(\"\n\"), { mode: 0o600 });
console.log(\"fuji payer      \" + addr(payer) + \"   <- 20 USDC from faucet.circle.com (Avalanche Fuji)\");
console.log(\"fuji payTo      \" + addr(payto) + \"   <- also the ERC-8004 validator; a little Fuji AVAX if you do A4\");
console.log(\"fuji agent      \" + addr(agent) + \"   <- ERC-8004 agent owner; a little Fuji AVAX if you do A4\");
" "$EVM_ENV")

echo "solana payer    $(solana-keygen pubkey "$SOL_PAYER")   <- 20 USDC from faucet.circle.com (Solana Devnet)"
echo "solana payTo    $(solana-keygen pubkey "$SOL_PAYTO")   <- run scripts/solana-devnet-prep-payto.sh next"
echo
echo "keys written to $KEYDIR (mode 600). Use them with:"
echo "  set -a; . $EVM_ENV; set +a                       # Avalanche demos"
echo "  export NIRIUM_PAYER_KEYPAIR=$SOL_PAYER              # Solana demo"
echo "  export PAY_TO=\$(solana-keygen pubkey $SOL_PAYTO)"
