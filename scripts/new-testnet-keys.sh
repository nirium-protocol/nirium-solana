#!/usr/bin/env bash
# Creates fresh Solana DEVNET keys for this project, outside the repo, readable only by you:
# a payer and a payTo keypair file (solana-keygen).
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
for f in "$SOL_PAYER" "$SOL_PAYTO"; do
  if [ -e "$f" ]; then echo "refusing: $f already exists (delete it yourself if you mean it)"; exit 2; fi
done

command -v solana-keygen >/dev/null || { echo "solana-keygen not found"; exit 2; }
solana-keygen new --no-bip39-passphrase --silent --outfile "$SOL_PAYER" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --outfile "$SOL_PAYTO" >/dev/null
chmod 600 "$SOL_PAYER" "$SOL_PAYTO"

echo "solana payer    $(solana-keygen pubkey "$SOL_PAYER")   <- 20 USDC from faucet.circle.com (Solana Devnet)"
echo "solana payTo    $(solana-keygen pubkey "$SOL_PAYTO")   <- run scripts/solana-devnet-prep-payto.sh next"
echo
echo "keys written to $KEYDIR (mode 600). Use them with:"
echo "  export NIRIUM_PAYER_KEYPAIR=$SOL_PAYER"
echo "  export PAY_TO=\$(solana-keygen pubkey $SOL_PAYTO)"
