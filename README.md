# 🎂 It's my birthday — can I treat you?

A cute multi-screen birthday-treat invite site with a Node backend that saves
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

1. **The ask** — "It's my birthday — can I treat you?" with a `no` button that
   runs away (and shrinks, while YES grows)
2. **The surprise** — "WAIT YOU ACTUALLY SAID YES??"
3. **When** — date picker + time dropdown (8:00 AM → 10:30 PM, 30-min steps)
4. **What are we eating** — biriyani / pizza / burgers / sushi / pasta / tacos /
   ramen / drinks / dessert
5. **The confirmation** — recap card + "I accept" button that saves to the database

Extras: floating 🎂🎉🎈, confetti bursts, a synthesized *Happy Birthday* tune
(🔈 button, top-right — no audio files needed), and a copyable share link.

## Where the data goes

Answers are saved to `data/responses.db` (SQLite, via Node's built-in
`node:sqlite` — no native compilation needed).

If SQLite can't open the file on your system, it automatically falls back to
`data/responses.jsonl` and keeps working. The `/admin` page shows which mode
is active.

Each row stores: name (optional), date, time, food, timestamp, IP, user agent.

**Read the data yourself:**

```bash
sqlite3 data/responses.db "SELECT * FROM responses;"
curl http://localhost:3000/api/responses          # same data as JSON
```

## Personalizing it

Everything lives in `public/index.html`:

| What | Where |
|---|---|
| The cake photo | `<img id="askPhoto" src="...">` — swap for your own image |
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
