# mooner.family: the landing page and its waitlist (site/server.mjs, no dependencies).
FROM node:22-slim
WORKDIR /app/site
COPY site/ ./
# /data is the volume: waitlist.db (emails, X accounts, wallets). 8080: mooner.family's target port.
ENV NODE_ENV=production WAITLIST_HOST=0.0.0.0 WAITLIST_PORT=8080 WAITLIST_DB=/data/waitlist.db WAITLIST_TRUST_PROXY=1
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
