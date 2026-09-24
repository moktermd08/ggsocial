# Deployment — ggsocial.gglink.co.uk

Live on the gglink server (178.62.119.192), following the same pattern as the
ggleads deployment on that box.

| Piece | Where |
| --- | --- |
| App code | `/var/www/ggsocial.gglink.co.uk` |
| Node process | pm2 `ggsocial-web` → `next start -p 3200` (127.0.0.1 only) |
| Scheduler | pm2 `ggsocial-scheduler` → ticks `/api/cron/publish` every 60s, `/api/cron/agents` every 5 min (brand agents; needs `ANTHROPIC_API_KEY` in `.env`), and hourly `/api/cron/goals` (follower counts daily, goal re-plans on Mondays), `/api/cron/pages` and `/api/cron/playbook` (posting-time suggestions for the daily review) |
| Database | Docker `ggsocial-pg` (postgres:16) on `127.0.0.1:5434`, volume `ggsocial-pgdata` |
| Web server | Apache vhosts `ggsocial.gglink.co.uk.conf` (:80, redirects) and `-le-ssl.conf` (:443 — the live one is the copy in `sites-enabled`, see traps) |
| TLS | Let's Encrypt, auto-renewing via the `/var/www/letsencrypt` webroot |
| Secrets | `/var/www/ggsocial.gglink.co.uk/.env` (chmod 600); copies in `/root/.ggsocial/` |
| Basic auth | `/etc/apache2/ggsocial.htpasswd` (root:www-data, 640) |
| Uploads | `/var/www/ggsocial.gglink.co.uk/.data/uploads` — on local disk, so back it up |

## Redeploying after a change

Commit first, load your SSH key into the agent once per login (the key has a
passphrase, and the script cannot type it), then deploy:

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
npm run deploy
```

[`scripts/deploy.sh`](scripts/deploy.sh) runs on your machine: it warns about
uncommitted changes, checks SSH works without a prompt, rsyncs the tree, then
streams [`scripts/deploy-remote.sh`](scripts/deploy-remote.sh) to the server
over `ssh … 'bash -s'`. The server half:

1. refuses to run if `.env` is missing,
2. backs up the database to `/root/ggsocial-backups/`,
3. `npm ci`, plus the Linux Tailwind binary pinned to the installed version,
4. `drizzle-kit push` — before the restart, or the new build serves pages whose
   columns do not exist yet,
5. pins `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` in `.env` the first time, then
   builds into `.next-new` (`distDir` comes from `NEXT_DIST_DIR`) stamped with
   a deployment id, and swaps it in — the old build serves throughout, so only
   the restart is a gap,
6. restarts both pm2 processes and polls `/login` until it is 200.

It stops at the first failing step. The scheduler always logs one
`tick failed: fetch failed` during the restart window — that one is expected;
repeated ones are not.

To check on it later without redeploying:

```bash
ssh gglink-live 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3200/login; pm2 list --no-color | grep ggsocial'
```

### Traps in this deploy, learned the hard way

**A tab left open across a deploy used to break on its next click.** It still
holds the old build's JavaScript, whose Server Action ids the new build no
longer has ("Failed to find Server Action"). Two things fix it, both set by the
deploy: `deploymentId` (`NEXT_DEPLOYMENT_ID`, the commit plus a timestamp,
worked out in `deploy.sh` because the server has no git checkout) makes Next
reload the page when the client's id and the server's differ, and
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` in `.env` keeps actions that did not
change working across builds. Losing that key is like losing `APP_SECRET`: it
is in the `/root/ggsocial-backups/env-*` copies. Note the protection only
starts once both sides of a deploy carry an id, so the first deploy after this
landed still broke open tabs.

**`rsync --delete` will destroy the production secrets.** `.env` lives only on
the server and is not in the repo, so without `--exclude .env` rsync deletes it
as "not in source". `.env.local` is a symlink to `.env`, so it goes too. Losing
`APP_SECRET` logs everyone out and makes stored platform tokens undecryptable —
channels would all need reconnecting. Copies of `.env` live in
`/root/ggsocial-backups/env-*/`, but `/root/.ggsocial/` holds only the basic-auth,
cron and pg secrets, *not* the full file.

**`npm ci` silently skips the Linux Tailwind binary.** The lockfile is generated
on macOS, and npm's optional-dependency handling omits
`@tailwindcss/oxide-linux-x64-gnu` on the server, so the build dies with
`Cannot find module './tailwindcss-oxide.linux-x64-gnu.node'`. The explicit
`npm install --no-save` in the deploy script pins it to the same version as the installed
`@tailwindcss/oxide`. `--no-save` keeps this platform artefact out of the
committed lockfile.

**Turbopack caches the failure.** After a failed build, a retry replays the same
error from the build directory even once the real cause is fixed. The deploy
script builds into a fresh `.next-new` every time, which sidesteps it — and
keeps the old build serving until the new one is ready, so a failed build no
longer takes the site down. Anything building by hand should `rm -rf` its
build directory first.

**A login shell builds with the wrong Node.** `bash -lc` sources nvm, which puts
Node 18.20.8 first on the PATH. Next 16 refuses to build on it
(`Node.js version ">=20.9.0" is required`), while pm2 runs `/usr/bin/node`
(20.20.2). The deploy script puts `/usr/bin` first on the PATH so install,
build and runtime all agree — installing under 18 also resolves a different set
of optional dependencies (412 packages vs 420). Worse, the failure lands *after*
`rm -rf .next`, so a running server is left without its build directory: check
`/login` immediately if a build ever fails mid-deploy.

**The login shell is fish.** Anything with `$(...)` passed straight to `ssh`
fails to parse and nothing runs — the backup step once silently produced no
backup. Nested quoting through fish then `bash -c` also broke the Tailwind pin
(`\047` reached Node literally, the version came back empty, and the install
quietly did nothing). The deploy script sidesteps both by streaming the server
half over stdin, so fish only ever parses `bash -s`. For ad-hoc commands,
wrap them in `bash -c`.

**Push the schema without `--force`.** Every change so far has been additive,
and drizzle applies additive changes without asking. Without `--force` it stops
instead of auto-approving a drop if the live schema has drifted; `< /dev/null`
makes that stop fail fast rather than hang on a prompt.

**The live :443 vhost is a copy, not a symlink.** In `/etc/apache2/sites-enabled/`,
`ggsocial.gglink.co.uk.conf` links to `sites-available`, but
`ggsocial.gglink.co.uk-le-ssl.conf` is a regular file — and the one Apache
serves. It has also drifted: only the live copy sets the HSTS,
`X-Content-Type-Options` and `Referrer-Policy` headers. An edit to
`sites-available/…-le-ssl.conf` passes `apachectl configtest`, reloads cleanly
and changes nothing, which is how the `/api/agent/` exception first failed.
Edit the `sites-enabled` copy (check with `apachectl -S`, which names the file
each vhost comes from), back it up to `/root/ggsocial-backups/` first, then
`apachectl configtest && systemctl reload apache2`. Every "both vhosts"
instruction below means `sites-available/ggsocial.gglink.co.uk.conf` and
`sites-enabled/ggsocial.gglink.co.uk-le-ssl.conf`.

Note `rsync` flattens when you pass individual files — always sync directories
(`./scripts/` → `…/scripts/`) or the whole tree.

## Before sharing tracked links

Short links (`/l/<code>`) are followed by strangers, so they have to get past
the basic-auth wall too — otherwise every reader gets a 401 password prompt.
They do no auth and return nothing but a 302 to the link's destination —
except to a link-preview crawler when the destination has no preview image of
its own and the brand has a social image: then the crawler gets a small card
page using that image, which needs `/api/media/file/` open too (see below).
Codes are random 7-character strings. Add this to **both** vhosts beside the
media block below, then `apachectl configtest && systemctl reload apache2`:

```apache
<Location /l/>
    Require all granted
</Location>
```

## Uploaded media is open

Instagram, Facebook, Pinterest and TikTok fetch post media from `APP_URL` with no
credentials, and so do link-preview crawlers loading a brand's social image, so
the media route is let past the basic-auth wall. This is already in both vhosts
(added 23 Sep 2026); re-add it if a vhost is ever rebuilt:

```apache
<Location /api/media/file/>
    Require all granted
</Location>
```

That makes uploaded files readable by anyone who has the (unguessable) URL. If
that is not acceptable for a client's unreleased content, move media to S3
(`MEDIA_DRIVER=s3`) and keep the app itself behind basic auth.

## AI agent access

The activity checklists and goals have an API for agents (Claude, ChatGPT,
scripts) at `/api/agent/activities`, `/api/agent/goals` and `/api/agent/brands`
(brand voice), with tokens issued
from **Activities → AI agents**.
Basic auth already occupies the `Authorization` header, so agents send their
token as `X-Agent-Token: ggs_…`. The agent API is let past the wall — every
route under it rejects requests without a valid, unrevoked token. This is
already in both vhosts (added 22 Sep 2026); re-add it if a vhost is ever
rebuilt:

```apache
<Location /api/agent/>
    Require all granted
</Location>
```

## Operating notes

- Logs: `pm2 logs ggsocial-web`, `pm2 logs ggsocial-scheduler`,
  `/var/log/apache2/ggsocial.gglink.co.uk-error.log`.
- Database shell: `docker exec -it ggsocial-pg psql -U ggsocial -d ggsocial`.
- Backup: `docker exec ggsocial-pg pg_dump -U ggsocial ggsocial | gzip > ggsocial-$(date +%F).sql.gz`
  plus a copy of `.data/uploads`. Nothing is scheduled — worth adding to whatever
  already backs up the other sites.
- Changing `APP_SECRET` logs everyone out and makes stored platform tokens
  undecryptable (channels then need reconnecting).
- pm2 survives reboots (`pm2-root` service is enabled and the list is saved).
