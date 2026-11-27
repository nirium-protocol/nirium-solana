# Image for the solana x402 market. Build context: the repository root.
#   fly deploy -c fly.market.toml --remote-only   (from the repository root)
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/solana
# The market uses the nirium-solana package from the folder above (file:..).
COPY solana/package.json solana/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY solana/sdk ./sdk
COPY solana/policy ./policy
COPY solana/verify-svm-receipt.mjs ./
COPY solana/market/package.json solana/market/package-lock.json ./market/
WORKDIR /app/solana/market
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY solana/market/data.mjs solana/market/server.mjs ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
