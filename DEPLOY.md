# Deploying to your own server

Target setup: Node runs as a systemd service on `127.0.0.1:3000`, nginx faces
the network on port 80, database lives in `/var/lib/treat`. Accessed by IP.

## Fast path

Copy the project to the server and run the installer:

```bash
# from your Mac
scp -r /path/to/treat you@YOUR_SERVER_IP:~/treat

# on the server
cd ~/treat
sudo bash deploy/install.sh
```

It creates the service user, installs to `/opt/treat`, sets up systemd and
nginx, opens port 80, and prints your URLs. It's idempotent — re-run it to
deploy updates.

Then open `http://YOUR_SERVER_IP/`.

## What it does, manually

If you'd rather do it yourself:

```bash
# 1. Node 22+ (needed for built-in SQLite)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# 2. App
sudo useradd --system --no-create-home --shell /usr/sbin/nologin treat
sudo mkdir -p /opt/treat /var/lib/treat
sudo cp -r . /opt/treat
cd /opt/treat && sudo npm install --omit=dev
sudo chown -R treat:treat /var/lib/treat

# 3. Service
sudo cp deploy/treat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now treat

# 4. nginx
sudo cp deploy/nginx-treat.conf /etc/nginx/sites-available/treat
sudo ln -sf /etc/nginx/sites-available/treat /etc/nginx/sites-enabled/treat
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## Before you share the link

**Change the admin key.** It's currently `saravanan`, and anyone who guesses it
can read every response and wipe your database.

```bash
sudo nano /etc/systemd/system/treat.service    # edit Environment=ADMIN_KEY=
sudo systemctl daemon-reload && sudo systemctl restart treat
```

**Clear your test data** from the bottom of `/admin` so the funnel starts clean.

## Day-to-day

```bash
journalctl -u treat -f            # live logs, every click shows up here
systemctl restart treat           # restart
systemctl status treat            # is it alive?
sqlite3 /var/lib/treat/responses.db "SELECT * FROM responses;"
```

Back up the database — it's a single file:

```bash
sudo cp /var/lib/treat/responses.db ~/treat-backup-$(date +%F).db
```

## If something's wrong

**502 Bad Gateway** — nginx is up but Node isn't. `journalctl -u treat -n 50`.

**Site unreachable** — port 80 blocked. Check your cloud provider's security
group as well as `ufw status`; the installer only handles ufw.

**"Could not save" on the final screen** — Node is running but can't write.
Check `ls -la /var/lib/treat` is owned by `treat`.

**Storage mode says `json`** — Node is older than 22, so `node:sqlite` isn't
available. It still works, writing to `.jsonl` files instead. Upgrade Node if
you want real SQLite.

## Getting off the raw IP

Sharing `http://203.0.113.5/` works but looks sketchy. Three ways to fix it,
best first:

**1. Free subdomain + real HTTPS.** Register a name at duckdns.org, deSEC or
afraid.org, point its A record at your server IP, then:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/treat      # server_name yourname.duckdns.org;
sudo certbot --nginx -d yourname.duckdns.org
```

End-to-end HTTPS, no middleman, free. This is the one to do.

**2. Your own domain.** Same as above with a domain you bought — `.xyz` and
`.site` are a couple of dollars a year.

**3. Vercel in front.** See `vercel-proxy/` — a `vercel.json` with a rewrite
gives you `https://something.vercel.app` without buying anything. Note the
Vercel-to-your-server hop stays plain HTTP.

**GitHub Pages can't do this.** It serves static files only, with no way to
forward requests to your server. A redirect page would just put the IP back in
the address bar. Keep the code on GitHub, but host the site on your server.

## Notes

- `app.set('trust proxy', true)` plus the `X-Forwarded-For` header in the nginx
  config means logged IPs are the real visitor, not `127.0.0.1`.
- The `/api/event` and `/api/response` endpoints are rate limited to 30/min per
  IP with a burst of 20, so nobody can flood your funnel stats.
- systemd runs the service with `ProtectSystem=strict` — the only writable path
  is `/var/lib/treat`. If you move the data directory, update `ReadWritePaths`
  in the unit file too, or writes will fail.
- Adding a domain later? Point it at the server, put `server_name yourdomain.com`
  in the nginx config, then `sudo certbot --nginx -d yourdomain.com` for free HTTPS.
