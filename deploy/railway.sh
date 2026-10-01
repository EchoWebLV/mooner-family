#!/bin/sh
# Deploys to Railway, project "mooner":
#   sh deploy/railway.sh app    the app, its API and /sim   service "app"  app.mooner.family
#   sh deploy/railway.sh site   the landing page + waitlist  service "web"  mooner.family
# Only the files listed here are uploaded: keys, .env files and databases stay on this machine.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROJECT=14215b7b-adff-430c-81f8-71e01298c7c3
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
case "${1:-}" in
  app)
    npm --prefix "$ROOT/web" run build
    mkdir -p "$STAGE/engine" "$STAGE/web"
    cp "$ROOT/engine/package.json" "$ROOT/engine/package-lock.json" "$STAGE/engine/"
    cp -R "$ROOT/engine/src" "$ROOT/engine/server" "$STAGE/engine/"
    cp -R "$ROOT/web/dist" "$STAGE/web/"
    HEALTH=/api/health
    SERVICE=app
    ;;
  site)
    mkdir -p "$STAGE/site"
    cp "$ROOT/site/index.html" "$ROOT/site/styles.css" "$ROOT/site/main.js" "$ROOT/site/mooji.js" "$ROOT/site/server.mjs" "$STAGE/site/"
    cp -R "$ROOT/site/assets" "$STAGE/site/"
    HEALTH=/
    SERVICE=web
    ;;
  *)
    echo "usage: sh deploy/railway.sh app|site" >&2
    exit 2
    ;;
esac
cp "$ROOT/deploy/$1.Dockerfile" "$STAGE/Dockerfile"
# a failed deploy leaves the last good one serving
cat > "$STAGE/railway.json" <<JSON
{ "build": { "builder": "DOCKERFILE" }, "deploy": { "healthcheckPath": "$HEALTH", "healthcheckTimeout": 300, "restartPolicyType": "ON_FAILURE" } }
JSON
find "$STAGE" -name '.*' -o -name '*.db' -o -name '*keypair*' -o -name '*.env' | grep . && { echo "refusing: a secret-looking file is staged" >&2; exit 1; }
railway up "$STAGE" --path-as-root --project "$PROJECT" --environment production --service "$SERVICE" --detach
