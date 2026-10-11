#!/bin/sh
# Deploys to Railway, project "mooner":
#   sh deploy/railway.sh app    the app, its API and /sim   service "app"  app.mooner.family
#   sh deploy/railway.sh site   the landing page + waitlist  service "web"  mooner.family
#   add --dry (sh deploy/railway.sh app --dry) to stage everything and list the files instead of uploading
# app ships HEAD: engine/{src,server} and a web/dist built in a temp folder from the committed web/, so an
# edit in progress in this checkout never goes out. site ships site/ as it is here (it isn't committed),
# with its join bundle built first.
# Only the files listed here are uploaded: keys, .env files and databases stay on this machine.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROJECT=14215b7b-adff-430c-81f8-71e01298c7c3
usage() {
  echo "usage: sh deploy/railway.sh app|site [--dry]" >&2
  exit 2
}
[ $# -le 2 ] || usage
case "${2:-}" in
  --dry) DRY=1 ;;
  "") DRY= ;;
  *) usage ;;
esac
STAGE=$(mktemp -d)
SRC=
trap 'rm -rf "$STAGE" ${SRC:+"$SRC"}' EXIT
# dash skips the EXIT trap on a signal: exiting runs it, so ^C or a kill still removes both folders
trap 'exit 1' HUP INT TERM
SRC=$(mktemp -d)
case "${1:-}" in
  app)
    REV=$(git -C "$ROOT" rev-parse HEAD)
    # to a file, not a pipe: a failed archive stops here (a pipe would report only tar's status)
    git -C "$ROOT" archive -o "$SRC/head.tar" "$REV" engine/package.json engine/package-lock.json engine/src engine/server web deploy/app.Dockerfile
    tar -x -C "$SRC" -f "$SRC/head.tar"
    rm "$SRC/head.tar"
    # what git doesn't hold: the packages (engine's for @noble/curves, which engine/src/walletcheck.js imports)
    # and web/.env, whose VITE_PRIVY_APP_ID is built into the bundle; .env files go to the build folder only
    ln -s "$ROOT/web/node_modules" "$SRC/web/node_modules"
    ln -s "$ROOT/engine/node_modules" "$SRC/engine/node_modules"
    for f in .env .env.local .env.production .env.production.local; do
      if [ -f "$ROOT/web/$f" ]; then cp "$ROOT/web/$f" "$SRC/web/"; fi
    done
    npm --prefix "$SRC/web" run build
    mkdir -p "$STAGE/engine" "$STAGE/web"
    cp "$SRC/engine/package.json" "$SRC/engine/package-lock.json" "$STAGE/engine/"
    cp -R "$SRC/engine/src" "$SRC/engine/server" "$STAGE/engine/"
    cp -R "$SRC/web/dist" "$STAGE/web/"
    FROM=$SRC
    HEALTH=/api/health
    SERVICE=app
    echo "deploying $(git -C "$ROOT" log -1 --format='%h (%s)' "$REV")"
    # --no-optional-locks: never take .git/index.lock while others commit
    if [ -n "$(git -C "$ROOT" --no-optional-locks status --porcelain -- engine web deploy)" ]; then
      echo "note: uncommitted changes in engine/, web/ or deploy/ are not included"
    fi
    ;;
  site)
    # the join bundle (site/assets/join/) is build output: made fresh, then shipped with assets/
    node "$ROOT/site/tools/build-join.mjs"
    mkdir -p "$STAGE/site"
    cp "$ROOT/site/index.html" "$ROOT/site/styles.css" "$ROOT/site/main.js" "$ROOT/site/mooji.js" "$ROOT/site/server.mjs" "$ROOT/site/privy.mjs" "$ROOT/site/disposable-domains.txt" "$STAGE/site/"
    cp -R "$ROOT/site/assets" "$STAGE/site/"
    FROM=$ROOT
    HEALTH=/
    SERVICE=web
    ;;
  *) usage ;;
esac
cp "$FROM/deploy/$1.Dockerfile" "$STAGE/Dockerfile"
# a failed deploy leaves the last good one serving
cat > "$STAGE/railway.json" <<JSON
{ "build": { "builder": "DOCKERFILE" }, "deploy": { "healthcheckPath": "$HEALTH", "healthcheckTimeout": 300, "restartPolicyType": "ON_FAILURE" } }
JSON
find "$STAGE" -name '.*' -o -name '*.db' -o -name '*keypair*' -o -name '*.env' | grep . && { echo "refusing: a secret-looking file is staged" >&2; exit 1; }
if [ -n "$DRY" ]; then
  (cd "$STAGE" && find . -type f | sed 's|^\./||' | sort)
  exit 0
fi
railway up "$STAGE" --path-as-root --project "$PROJECT" --environment production --service "$SERVICE" --detach
