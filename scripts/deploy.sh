#!/usr/bin/env bash
# Deploy the working tree to ggsocial.gglink.co.uk. Run from anywhere:
#   npm run deploy
# See DEPLOY.md for what lives where on the server.
set -euo pipefail

HOST=${DEPLOY_HOST:-gglink-live}
APP_DIR=/var/www/ggsocial.gglink.co.uk

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Warning: uncommitted changes will be deployed:"
  git status --short
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" == [yY] ]] || exit 1
fi

# BatchMode: fail now with a clear message instead of prompting for a password
# halfway through. A passphrase-protected key must be in the agent first.
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null; then
  echo "Cannot ssh to $HOST without a prompt. Load your key first:" >&2
  echo "  ssh-add --apple-use-keychain ~/.ssh/id_ed25519" >&2
  exit 1
fi

echo "==> Syncing code to $HOST:$APP_DIR"
# --exclude .env is not optional: .env exists only on the server, so --delete
# would remove it and take APP_SECRET (and every stored token) with it.
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .data --exclude .git \
  --exclude .env --exclude .env.local --exclude .claude \
  ./ "$HOST:$APP_DIR/"

# Identifies this release to the browser: a tab still on the old build sends
# its own id, and Next reloads the page rather than failing the click. The
# server has no git checkout, so it is worked out here.
DEPLOY_ID="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)"

# Stream the server half over stdin: the remote login shell is fish, and this
# way it only ever parses `bash -s`. `env` carries the id across, because fish
# does not understand `VAR=value command`.
ssh "$HOST" "env DEPLOY_ID=$DEPLOY_ID bash -s" < scripts/deploy-remote.sh
