# Image de production : le serveur de jeu sert l'API, le temps réel et le site compilé.
FROM node:22-slim
WORKDIR /app

# Dépendances d'abord (mises en cache tant que les package.json ne changent pas).
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund

COPY shared shared
COPY server server
COPY client client
RUN npm run build -w client

ENV NODE_ENV=production STATIC_DIR=/app/client/dist TRUST_PROXY=1
EXPOSE 3001
CMD ["npm", "start", "-w", "server"]
