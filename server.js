const express = require('express');
const path = require('path');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Change this to protect /admin. Set ADMIN_KEY env var, or leave blank for open access.
const ADMIN_KEY = process.env.ADMIN_KEY || 'saravanan';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true);

const meta = (req) => ({
  user_agent: (req.get('user-agent') || '').slice(0, 300),
  ip: req.ip,
});

/* ---------- track every step ---------- */
app.post('/api/event', (req, res) => {
  const { session, step, detail } = req.body || {};
  if (!session || !step) return res.status(400).json({ error: 'session and step required' });

  try {
    const saved = store.saveEvent({ session, step, detail, ...meta(req) });
    console.log(`· ${String(step).padEnd(11)} ${String(session).slice(0, 8)}${detail ? '  ' + detail : ''}`);
    res.json({ ok: true, id: saved.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not save event' });
  }
});

/* ---------- save the final response ---------- */
app.post('/api/response', (req, res) => {
  const { name, date, time, food } = req.body || {};

  if (!date || !time || !food) {
    return res.status(400).json({ error: 'date, time and food are required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'bad date or time format' });
  }

  try {
    const saved = store.save({
      name: typeof name === 'string' ? name.slice(0, 100) : null,
      date, time, food: String(food).slice(0, 60),
      ...meta(req),
    });
    console.log(`🎉 new response #${saved.id}: ${date} ${time} · ${food}`);
    res.json({ ok: true, id: saved.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not save' });
  }
});

/* ---------- read it back ---------- */
function authed(req) {
  return !ADMIN_KEY || req.query.key === ADMIN_KEY;
}
const guard = (req, res, next) =>
  authed(req) ? next() : res.status(401).json({ error: 'unauthorized' });

app.get('/api/responses', guard, (req, res) => res.json(store.list()));
app.get('/api/events',    guard, (req, res) => res.json(store.listEvents(1000)));
app.get('/api/funnel',    guard, (req, res) =>
  res.json({ funnel: store.funnel(), sessions: store.sessions() })
);

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

app.get('/admin', (req, res) => {
  if (!authed(req)) {
    return res.status(401).send('<h2 style="font-family:sans-serif">Unauthorized — add ?key=YOUR_ADMIN_KEY</h2>');
  }

  const k = ADMIN_KEY ? '?key=' + encodeURIComponent(ADMIN_KEY) : '';
  const rows = store.list();
  const fun = store.funnel();
  const sess = store.sessions();
  const events = store.listEvents(150);
  const labelOf = Object.fromEntries(store.STEPS);
  const visits = (fun.find((f) => f.step === 'visit') || {}).count || 0;

  const funnelRows = fun.map((f, i) => {
    const prev = i > 0 && fun[i - 1].count ? fun[i - 1].count : null;
    const drop = prev != null && f.step !== 'no_dodge' && fun[i - 1].step !== 'no_dodge'
      ? prev - f.count : null;
    return `<tr>
      <td><b>${esc(f.label)}</b><div class="dim">${esc(f.step)}</div></td>
      <td class="num">${f.count}</td>
      <td style="width:42%"><div class="bar"><span style="width:${f.pct}%"></span></div></td>
      <td class="num dim">${f.pct}%</td>
      <td class="num dim">${drop ? '−' + drop : ''}</td>
    </tr>`;
  }).join('');

  const sessRows = sess.length ? sess.map((s) => `<tr>
      <td class="mono">${esc(s.session).slice(0, 10)}</td>
      <td><b>${esc(labelOf[s.furthest] || s.furthest)}</b></td>
      <td class="num">${s.stepCount}</td>
      <td class="dim">${new Date(s.first).toLocaleString()}</td>
      <td class="dim">${new Date(s.last).toLocaleString()}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No visits yet</td></tr>';

  const respRows = rows.length ? rows.map((r) => {
    const d = new Date(r.date + 'T00:00:00');
    const day = isNaN(d) ? r.date
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return `<tr>
      <td>${r.id}</td>
      <td>${esc(r.name) || '<i class="dim">—</i>'}</td>
      <td><b>${esc(day)}</b></td>
      <td>${esc(r.time)}</td>
      <td>${esc(r.food)}</td>
      <td class="dim">${new Date(r.created_at).toLocaleString()}</td>
    </tr>`;
  }).join('')
    : '<tr><td colspan="6" class="empty">No responses yet 🎂</td></tr>';

  const eventRows = events.length ? events.map((e) => `<tr>
      <td class="mono">${esc(e.session).slice(0, 10)}</td>
      <td>${esc(labelOf[e.step] || e.step)}</td>
      <td class="dim">${esc(e.detail) || ''}</td>
      <td class="dim">${new Date(e.created_at).toLocaleString()}</td>
    </tr>`).join('')
    : '<tr><td colspan="4" class="empty">No events yet</td></tr>';

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Treat dashboard</title>
<style>
 body{font-family:Inter,system-ui,sans-serif;background:#fdf1f4;color:#5c1730;margin:0;padding:34px 20px 60px}
 .wrap{max-width:920px;margin:0 auto}
 h1{font-family:Georgia,serif;font-size:26px;margin:0 0 4px}
 h2{font-family:Georgia,serif;font-size:18px;margin:34px 0 10px;font-weight:600}
 .meta{color:#8a5468;font-size:13px;margin-bottom:8px}
 .cards{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0 6px}
 .card{background:#fff;border-radius:14px;padding:14px 18px;min-width:118px;box-shadow:0 8px 24px rgba(160,60,100,.10)}
 .card .n{font-size:26px;font-weight:600;color:#e0357f;line-height:1.2}
 .card .l{font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:#a3446e;margin-top:2px}
 table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(160,60,100,.10)}
 th{background:#fce4ee;text-align:left;padding:11px 13px;font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:#a3446e}
 td{padding:11px 13px;border-top:1px solid #f6e9ee;font-size:14px;vertical-align:middle}
 tr:hover td{background:#fffafc}
 .num{text-align:right;white-space:nowrap}
 .dim{color:#a98da0;font-size:12.5px}
 .mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#8a5468}
 .empty{text-align:center;padding:34px;color:#c9adbb}
 .bar{background:#f6e4ec;border-radius:999px;height:9px;overflow:hidden}
 .bar span{display:block;height:100%;background:#e0357f;border-radius:999px}
 a{color:#e0357f}
</style></head><body><div class="wrap">
<h1>🎂 Treat dashboard</h1>
<div class="meta">storage: <b>${store.mode}</b> ·
 <a href="/api/funnel${k}">funnel JSON</a> ·
 <a href="/api/events${k}">events JSON</a> ·
 <a href="/api/responses${k}">responses JSON</a></div>

<div class="cards">
  <div class="card"><div class="n">${visits}</div><div class="l">Visits</div></div>
  <div class="card"><div class="n">${sess.length}</div><div class="l">Sessions</div></div>
  <div class="card"><div class="n">${rows.length}</div><div class="l">Confirmed</div></div>
  <div class="card"><div class="n">${visits ? Math.round((rows.length / visits) * 100) : 0}%</div><div class="l">Conversion</div></div>
</div>

<h2>Funnel — how far people got</h2>
<table><thead><tr><th>Step</th><th class="num">People</th><th>Share</th><th class="num">%</th><th class="num">Lost</th></tr></thead>
<tbody>${funnelRows}</tbody></table>

<h2>Confirmed treats</h2>
<table><thead><tr><th>#</th><th>Name</th><th>Day</th><th>Time</th><th>Food</th><th>Submitted</th></tr></thead>
<tbody>${respRows}</tbody></table>

<h2>Visitors</h2>
<table><thead><tr><th>Session</th><th>Got as far as</th><th class="num">Steps</th><th>First seen</th><th>Last seen</th></tr></thead>
<tbody>${sessRows}</tbody></table>

<h2>Recent activity</h2>
<table><thead><tr><th>Session</th><th>Step</th><th>Detail</th><th>When</th></tr></thead>
<tbody>${eventRows}</tbody></table>
</div></body></html>`);
});

app.listen(PORT, () => {
  console.log(`\n  🎂 Treat site running → http://localhost:${PORT}`);
  console.log(`  📊 Dashboard          → http://localhost:${PORT}/admin${ADMIN_KEY ? '?key=' + ADMIN_KEY : ''}`);
  console.log(`  💾 Storage mode       → ${store.mode}\n`);
});
