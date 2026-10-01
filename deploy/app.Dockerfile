# app.mooner.family: the Mooner server (gate co-signer, mint issuer, keeper, live socket)
# serving the real app at / and the simulation at /sim. deploy/railway.sh stages only
# engine/{src,server} and the built web/dist; keys come from variables, never files here.
FROM node:22-slim
WORKDIR /app/engine
COPY engine/package.json engine/package-lock.json ./
RUN npm ci --omit=dev
COPY engine/src ./src
COPY engine/server ./server
COPY web/dist /app/web/dist
# /data is the volume: server.db (mint secrets, chat, profiles). 8080: the domain's target port.
ENV NODE_ENV=production MOONER_HOST=0.0.0.0 MOONER_PORT=8080 MOONER_DIR=/data MOONER_TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.js"]
