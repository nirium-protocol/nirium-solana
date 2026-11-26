#!/usr/bin/env bash
# Solana devnet: gives the payTo wallet its USDC token account, which must exist before
# a PayAI exact payment (otherwise: invalid_exact_svm_recipient_ata_missing).
# The payTo keypair pays the rent, so it first gets 1 devnet SOL by airdrop.
set -euo pipefail
KEYDIR="${NIRIUM_KEY_DIR:-$HOME/.nirium-keys}"
PAYTO_KEY="${1:-$KEYDIR/sol-devnet-payto.json}"
MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU   # devnet USDC used by @x402/svm and PayAI
URL=https://api.devnet.solana.com
PAYTO="$(solana-keygen pubkey "$PAYTO_KEY")"
echo "payTo $PAYTO"
BAL="$(solana balance "$PAYTO" --url $URL | cut -d" " -f1)"
if awk "BEGIN{exit !($BAL < 0.01)}"; then
  solana airdrop 1 "$PAYTO" --url $URL || { echo "airdrop failed (rate limit?). Try faucet.solana.com, then rerun."; exit 1; }
fi
spl-token create-account "$MINT" --owner "$PAYTO" --fee-payer "$PAYTO_KEY" --url $URL 2>&1 | grep -v "^$" || true
echo "USDC token account for payTo:"
spl-token address --token "$MINT" --owner "$PAYTO" --verbose --url $URL | grep -i "associated token address"
spl-token accounts --owner "$PAYTO" --url $URL
