# Vercel reverse proxy

Puts a `https://something.vercel.app` address in front of the treat site running
on your own server, so you never share a raw IP.

**Nothing from the app gets deployed here.** Vercel only forwards traffic — your
server still runs the Node app and holds the database.

## Setup

1. Edit `vercel.json` and replace `YOUR_SERVER_IP` with your server's IP.
2. Push this folder (just this folder) to its own GitHub repo.
3. On vercel.com: **Add New → Project → import that repo**.
   - Framework preset: **Other**
   - Leave build and output settings empty
4. Deploy. You get `https://your-project.vercel.app`.

Or from this directory, without GitHub:

```bash
npm i -g vercel
vercel --prod
```

## Check it worked

```bash
curl -sI https://your-project.vercel.app | head -3
curl -s https://your-project.vercel.app | grep -o "birthday treat"
```

## Things to know

**The Vercel → your server hop is plain HTTP.** Visitors get HTTPS up to
Vercel, but the leg from Vercel to your box is unencrypted. For a birthday
invite that's a fair trade; don't reuse this pattern for anything sensitive.
Point the rewrite at `https://` instead once your server has a certificate.

**Your admin key passes through Vercel.** Prefer visiting `/admin` directly on
the server IP rather than through the proxy.

**Visitor IPs still work.** Vercel sets `X-Forwarded-For`, and the app already
runs `app.set('trust proxy', true)`, so the dashboard keeps showing real
visitor IPs rather than Vercel's.

**Free tier has bandwidth limits.** The gif is ~350 KB per first visit. Fine for
friends, not for a link that goes viral.

**Your server must stay reachable on port 80** — Vercel connects to it directly.
This hides your IP from casual visitors, not from anyone determined.

## The simpler alternative

A free subdomain avoids the extra hop entirely:

1. Register a hostname at duckdns.org (or deSEC, afraid.org)
2. Set its A record to your server IP
3. On the server, put the hostname in the nginx config and run:
   `sudo certbot --nginx -d yourname.duckdns.org`

You get real end-to-end HTTPS, no proxy, no bandwidth cap.
