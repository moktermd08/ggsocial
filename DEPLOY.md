# Deployment — ggsocial.gglink.co.uk

Live on the gglink server (178.62.119.192), following the same pattern as the
ggleads deployment on that box.

| Piece | Where |
| --- | --- |
| App code | `/var/www/ggsocial.gglink.co.uk` |
| Node process | pm2 `ggsocial-web` → `next start -p 3200` (127.0.0.1 only) |
| Scheduler | pm2 `ggsocial-scheduler` → ticks `/api/cron/publish` every 60s |
| Database | Docker `ggsocial-pg` (postgres:16) on `127.0.0.1:5434`, volume `ggsocial-pgdata` |
| Web server | Apache vhosts `ggsocial.gglink.co.uk.conf` (:80, redirects) and `-le-ssl.conf` (:443) |
| TLS | Let's Encrypt, auto-renewing via the `/var/www/letsencrypt` webroot |
| Secrets | `/var/www/ggsocial.gglink.co.uk/.env` (chmod 600); copies in `/root/.ggsocial/` |
| Basic auth | `/etc/apache2/ggsocial.htpasswd` (root:www-data, 640) |
| Uploads | `/var/www/ggsocial.gglink.co.uk/.data/uploads` — on local disk, so back it up |

## Redeploying after a change

Run the steps in this order. The schema push must land **before** the restart,
or the new build serves pages whose columns do not exist yet.

**1. Back up.** Nothing is scheduled, so this is the only rollback point:

```bash
ssh gglink-live 'docker exec ggsocial-pg pg_dump -U ggsocial ggsocial | gzip > /root/ggsocial-backups/ggsocial-$(date +%F-%H%M).sql.gz'
```

**2. Sync the code.** `--exclude .env` is not optional — see the warning below:

```bash
rsync -az --delete --exclude node_modules --exclude .next --exclude .data --exclude .git --exclude .env --exclude .env.local --exclude .claude ./ gglink-live:/var/www/ggsocial.gglink.co.uk/
```

**3. Install, migrate, build, restart:**

```bash
ssh gglink-live 'bash -lc "cd /var/www/ggsocial.gglink.co.uk \
  && npm ci --no-audit --no-fund \
  && npm install --no-save --no-audit --no-fund @tailwindcss/oxide-linux-x64-gnu@\$(node -p \"require(\047./node_modules/@tailwindcss/oxide/package.json\047).version\") \
  && npx drizzle-kit push --force \
  && rm -rf .next && npm run build \
  && pm2 restart ggsocial-web ggsocial-scheduler --update-env"'
```

**4. Verify:**

```bash
ssh gglink-live 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3200/login; pm2 list --no-color | grep ggsocial'
```

`/login` should be 200 and both processes `online`. The scheduler always logs one
`tick failed: fetch failed` during the restart window — that one is expected;
repeated ones are not.

### Three traps in this deploy, learned the hard way

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
`npm install --no-save` above pins it to the same version as the installed
`@tailwindcss/oxide`. `--no-save` keeps this platform artefact out of the
committed lockfile.

**Turbopack caches the failure.** After a failed build, a retry replays the same
error from `.next/build/chunks/` even once the real cause is fixed. Always
`rm -rf .next` before rebuilding, which is why it is in the command above.

Note `rsync` flattens when you pass individual files — always sync directories
(`./scripts/` → `…/scripts/`) or the whole tree.

## Before switching a channel to live mode

Instagram, Facebook, Pinterest and TikTok fetch post media from `APP_URL` with no
credentials, so the basic-auth wall will block them. Uncomment this block in
**both** vhosts and reload Apache:

```apache
<Location /api/media/file/>
    Require all granted
</Location>
```

That makes uploaded files readable by anyone who has the (unguessable) URL. If
that is not acceptable for a client's unreleased content, move media to S3
(`MEDIA_DRIVER=s3`) and keep the app itself behind basic auth.

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
