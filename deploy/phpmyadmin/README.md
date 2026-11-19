# phpMyAdmin for Vango Panel

Adds a **phpMyAdmin** button to each database on a server's Databases tab. Clicking it opens
phpMyAdmin in a new tab, already signed in to that database.

How it works:

1. The panel creates a random one-time token (valid 60 s, single use, only its hash is stored) and
   opens `<PHPMYADMIN_URL>/vango-signon.php?token=…`.
2. `vango-signon.php` POSTs the token to the panel's `/api/phpmyadmin/redeem` (server-to-server,
   authenticated with the shared secret). The panel re-checks the user's access and returns the
   database's host, username and password.
3. The script puts these into phpMyAdmin's signon session and redirects into the database. The
   password never reaches the browser.

The button only shows for users with the `database.view-password` permission, since signing in
gives the same access as knowing the password.

## Setup

Run as root on the panel host.

1. Generate a secret: `openssl rand -base64 48`.

2. Add to the panel's env (`apps/web/.env`), then push the schema, rebuild and restart:

   ```sh
   PHPMYADMIN_URL=http://192.168.2.108:8081
   PHPMYADMIN_SIGNON_SECRET=<secret>
   ```

   ```sh
   bun install && bun run db:push && bun run build && systemctl restart vango-panel
   ```

3. Find wings' Docker network (the one whose subnet database users are allowed from, e.g. `172.31.250.0/24`):

   ```sh
   docker network ls
   docker network inspect -f '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}' $(docker network ls -q)
   ```

4. Configure and start phpMyAdmin:

   ```sh
   cd deploy/phpmyadmin
   cp .env.example .env   # fill in PHPMYADMIN_URL, PANEL_URL, PHPMYADMIN_SIGNON_SECRET, WINGS_NETWORK
   docker compose up -d
   ```

5. If the panel is served through NetBird, you can add a route for port 8081 too and use that URL
   as `PHPMYADMIN_URL` in **both** env files.

## Notes

- phpMyAdmin connects to the database host's **Servers connect to** address (Admin → Databases),
  from wings' network, i.e. the same way game servers do. No extra MariaDB grants are needed.
- `PANEL_INTERNAL_URL` must reach the panel directly (default `http://host.docker.internal:3001`),
  not through proxy auth.
- Changing the password inside phpMyAdmin is disabled; use **Rotate password** in the panel.
- Logging out of phpMyAdmin clears the signon session and returns to the panel.
