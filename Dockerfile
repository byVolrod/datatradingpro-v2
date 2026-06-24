# ── DataTradingPro — Dockerfile (Render / Fly.io / VPS) ─────────────────────────
# Alternative à nixpacks.toml pour les plateformes qui préfèrent Docker.
# Railway accepte aussi ce Dockerfile.

# Node 22 (LTS) : inclut WebSocket natif requis par @supabase/supabase-js
FROM node:22-slim

# Chromium + dépendances système pour Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    poppler-utils \
    python3 \
    make \
    g++ \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Variables Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Installer les dépendances en premier (cache Docker layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copier le code source
COPY . .

# Port exposé (Railway injecte $PORT automatiquement)
EXPOSE 3000

CMD ["node", "server.js"]
