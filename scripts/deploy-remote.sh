#!/usr/bin/env bash
# Server half of the deploy. Not run directly: scripts/deploy.sh streams it
# over ssh (`ssh host 'bash -s' < this file`), so no shell ever has to parse
# nested quotes — which is what broke the old one-liner under fish.
set -euo pipefail

APP_DIR=/var/www/ggsocial.gglink.co.uk
BACKUP_DIR=/root/ggsocial-backups

# /usr/bin first: a login shell puts nvm's Node 18 ahead of it, and Next 16
# refuses to build on 18. pm2 runs /usr/bin/node, so build with the same one.
export PATH=/usr/bin:/usr/local/bin:/bin

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

cd "$APP_DIR"

# rsync --delete without --exclude .env wipes the production secrets. Stop
# before touching anything if that has happened.
if [[ ! -s .env ]]; then
  echo "ERROR: $APP_DIR/.env is missing or empty. Restore it from $BACKUP_DIR/env-*/ before deploying." >&2
  exit 1
fi

step "Backing up the database"
mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/ggsocial-$(date +%F-%H%M).sql.gz"
docker exec ggsocial-pg pg_dump -U ggsocial ggsocial | gzip > "$backup"
echo "Saved $backup ($(du -h "$backup" | cut -f1))"

step "Installing dependencies"
npm ci --no-audit --no-fund

# npm ci skips the Linux Tailwind binary because the lockfile is made on macOS.
# Pin it to the installed @tailwindcss/oxide; --no-save keeps it out of the lockfile.
oxide_version=$(node -p 'require("./node_modules/@tailwindcss/oxide/package.json").version')
npm install --no-save --no-audit --no-fund "@tailwindcss/oxide-linux-x64-gnu@${oxide_version}"

step "Applying schema changes"
# No --force: if the live schema has drifted, stop instead of approving a drop.
# </dev/null makes that stop fail fast rather than hang on a prompt.
npx drizzle-kit push --verbose < /dev/null

# Server Actions are encrypted with a key generated per build unless one is
# pinned, and a new key alone breaks a tab left open across a deploy. Written
# once, then reused by every later build.
if ! grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' .env; then
  step "Pinning the Server Actions encryption key"
  printf '\nNEXT_SERVER_ACTIONS_ENCRYPTION_KEY="%s"\n' "$(openssl rand -base64 32)" >> .env
  cp .env "$BACKUP_DIR/env-$(date +%F-%H%M).bak" 2>/dev/null || true
  echo "Added NEXT_SERVER_ACTIONS_ENCRYPTION_KEY to .env"
fi

step "Building"
# Built into .next-new, never over the build being served: the site stays up
# for the whole build, and a failure leaves the old build untouched. A fresh
# directory each time also avoids Turbopack replaying a cached failure.
trap 'echo >&2; echo "BUILD FAILED — the old build is still serving, so the site is UP on the previous version. Fix and rerun scripts/deploy.sh." >&2' ERR
rm -rf .next-new .next-old
export NEXT_DEPLOYMENT_ID="${DEPLOY_ID:-$(date -u +%Y%m%d%H%M%S)}"
echo "Deployment id: $NEXT_DEPLOYMENT_ID"
NEXT_DIST_DIR=.next-new npm run build
trap - ERR

step "Restarting"
# Swap in the new build and restart at once: the gap is this pair of renames,
# about a second, rather than the length of the build.
if [[ -d .next ]]; then mv .next .next-old; fi
mv .next-new .next
pm2 restart ggsocial-web ggsocial-scheduler --update-env

step "Verifying"
for attempt in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3200/login || true)
  [[ "$code" == 200 ]] && break
  sleep 2
done
pm2 list --no-color | grep ggsocial || true
if [[ "$code" != 200 ]]; then
  echo "ERROR: /login returned $code after restart. Check: pm2 logs ggsocial-web" >&2
  exit 1
fi
rm -rf .next-old
echo "OK — /login is 200."
