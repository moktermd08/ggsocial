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

From this repo:

```bash
rsync -az --delete --exclude node_modules --exclude .next --exclude .data --exclude .git --exclude .env.local --exclude .claude ./ gglink-live:/var/www/ggsocial.gglink.co.uk/
```

Then on the server:

```bash
ssh gglink-live 'bash -lc "cd /var/www/ggsocial.gglink.co.uk && npm ci --no-audit --no-fund && npm run build && pm2 restart ggsocial-web"'
```

Schema changes need `npx drizzle-kit push` in that directory before the restart.
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
