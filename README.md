# 🎂 Will you give me a birthday treat?

A cute multi-screen birthday-treat request site with a Node backend that saves
every answer to a database.

## Run it

```bash
npm install
npm start
```

Then open:

- **The site** → http://localhost:3000
- **Responses** → http://localhost:3000/admin

## The 5 screens

1. **The ask** — "Will you give me a birthday treat?" with a `no` button that
   runs away (and shrinks, while YES grows)
2. **The surprise** — "WAIT YOU ACTUALLY SAID YES??"
3. **When** — date picker + time dropdown (8:00 AM → 10:30 PM, 30-min steps)
4. **What are we eating** — biriyani / dosa / parotta / fish / pizza / burgers /
   ramen / drinks / dessert
5. **The confirmation** — recap card + "I accept" button that saves to the
   database, then a full-screen celebration with the best-friend cats gif

Extras: floating 🎂🎉🎈, confetti bursts, a synthesized *Happy Birthday* tune
that plays once when they hit YES (no audio files needed), and a copyable
share link.

## Step tracking

Every click is recorded, not just the final answer — so you can see how many
people opened the page and where they dropped off.

Each visitor gets a random session id (kept in `localStorage`, so a reload
doesn't double-count them). These steps are logged:

If you send a personalised link (`.../?to=Priya`), that name rides along with
every event, so the dashboard's **Who** column shows "Priya" instead of a
session id — on every row, not just the final response. Visitors without a
`?to=` fall back to their short session id.

| Step | When |
|---|---|
| `visit` | page opened |
| `no_dodge` | tried to click "no" (logged at dodge 1, 5, 10) |
| `yes` | clicked YES — detail records how many dodges it took |
| `intro_done` | past the surprise screen |
| `date_time` | picked day + time |
| `food_tap` | tapped a food tile (fires on each change of mind) |
| `food` | confirmed the food |
| `accept_click` | pressed "I accept" |
| `accepted` | save succeeded |
| `save_failed` | save errored — detail has the reason |

The dashboard at `/admin` shows visits, sessions, conversion rate, a funnel bar
chart, every visitor with how far they got, and a recent-activity log.

### Device and IP

Every response and every event stores the visitor's IP and user agent. The
dashboard shows them in a **Device / IP** column, parsed into something readable
— `📱 iPhone · WhatsApp`, `💻 Mac · Chrome`, `🖥️ Windows · Edge`. Hover the label
to see the raw user-agent string.

In-app browsers are detected too (WhatsApp, Instagram, Telegram, Facebook,
Snapchat, LINE), which is usually how a shared link gets opened.

Worth knowing: IP + user agent identify a *device*, roughly — not a person.
Phones on mobile data share IPs and change them, and two friends with the same
phone model look identical. If you need to know who answered, the `?to=` name
parameter is the reliable way: send `.../?to=Priya` and it's stored with the
response.

Tracking uses `navigator.sendBeacon`, so events still arrive if they close the
tab mid-flow. It's wrapped in try/catch — if tracking fails, the page still works.

## Where the data goes

Everything lands in `data/responses.db` (SQLite, via Node's built-in
`node:sqlite` — no native compilation needed), in two tables:

- `responses` — one row per confirmed treat: name, date, time, food, timestamp, IP, user agent
- `events` — one row per click: session, step, detail, timestamp, IP, user agent

If SQLite can't open the file on your system, it falls back to
`data/responses.jsonl` + `data/events.jsonl` and keeps working. The `/admin`
page shows which mode is active.

**Clearing it:** the bottom of `/admin` has three buttons — clear tracking
events, clear responses, or clear everything. Each asks for confirmation
(wiping everything asks twice) and ids restart at 1 afterwards. Handy for
resetting after you've tested, before sending the real link.

The endpoint behind it is `POST /api/clear` with `{"what":"all"}` — POST only
and key-protected, so no stray link can trigger it.

**Read the data yourself:**

```bash
sqlite3 data/responses.db "SELECT * FROM responses;"
sqlite3 data/responses.db "SELECT step, COUNT(DISTINCT session) FROM events GROUP BY step;"

curl "http://localhost:3000/api/responses?key=saravanan"
curl "http://localhost:3000/api/events?key=saravanan"
curl "http://localhost:3000/api/funnel?key=saravanan"
```

## Personalizing it

Everything lives in `public/index.html`:

| What | Where |
|---|---|
| Celebration gif | `public/best-friends-bestie.gif` — drop in any gif with the same name, or change `img.cats` |
| The cake | inline `<svg class="cake">` on screen 1 |
| Final message | screen `s5` `<h1>` |
| Food options | `const FOODS = [...]` |
| The escalating "no" button text | `const nopes = [...]` |
| Colors | `:root` CSS variables at the top |
| Melody | `const MELODY = [...]` (Hz; `0` = rest) |

You can also pre-fill a name via the URL: `?to=Priya` — it gets stored with the response.

## Protecting /admin

`ADMIN_KEY` is currently set to `saravanan` in `server.js`, so `/admin` needs a key:

```
http://localhost:3000/admin?key=saravanan
```

Override it at runtime with `ADMIN_KEY=somethingelse npm start`.

## Putting it online

Any Node host works (Render, Railway, Fly.io, a VPS). It listens on
`process.env.PORT`. For hosts with ephemeral disks, mount a persistent volume
and point `DATA_DIR` at it:

```bash
DATA_DIR=/data ADMIN_KEY=mysecret npm start
```
