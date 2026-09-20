/**
 * pm2 processes for the gglink deployment.
 *   ggsocial-web        — the Next server behind Apache on 127.0.0.1:3200
 *   ggsocial-scheduler  — ticks /api/cron/publish so scheduled posts go out
 *
 * Secrets come from .env (chmod 600), never from this file.
 */
const cwd = "/var/www/ggsocial.gglink.co.uk";

module.exports = {
  apps: [
    {
      name: "ggsocial-web",
      cwd,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3200",
      env: { NODE_ENV: "production", PORT: "3200" },
      max_memory_restart: "700M",
      autorestart: true,
    },
    {
      name: "ggsocial-scheduler",
      cwd,
      script: "scripts/scheduler.mjs",
      max_memory_restart: "200M",
      autorestart: true,
    },
  ],
};
