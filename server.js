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

/* ---------- save a response ---------- */
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
      user_agent: (req.get('user-agent') || '').slice(0, 300),
      ip: req.ip,
    });
    console.log(`🎉 new response #${saved.id}: ${date} ${time} · ${food}`);
    res.json({ ok: true, id: saved.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not save' });
  }
});

/* ---------- read responses ---------- */
function authed(req) {
  return !ADMIN_KEY || req.query.key === ADMIN_KEY;
}

app.get('/api/responses', (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });
  res.json(store.list());
});

app.get('/admin', (req, res) => {
  if (!authed(req)) {
    return res.status(401).send('<h2 style="font-family:sans-serif">Unauthorized — add ?key=YOUR_ADMIN_KEY</h2>');
  }

  const rows = store.list();
  const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const body = rows.length
    ? rows.map((r) => {
        const d = new Date(r.date + 'T00:00:00');
        const day = isNaN(d) ? r.date : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        return `<tr>
          <td>${r.id}</td>
          <td>${esc(r.name) || '<i style="color:#bba">—</i>'}</td>
          <td><b>${esc(day)}</b></td>
          <td>${esc(r.time)}</td>
          <td>${esc(r.food)}</td>
          <td class="dim">${new Date(r.created_at).toLocaleString()}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:40px;color:#bba">No responses yet ♥</td></tr>';

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Responses</title>
<style>
 body{font-family:Inter,system-ui,sans-serif;background:#fdf1f4;color:#5c1730;margin:0;padding:36px 20px}
 .wrap{max-width:900px;margin:0 auto}
 h1{font-family:Georgia,serif;font-size:26px;margin:0 0 4px}
 .meta{color:#8a5468;font-size:13px;margin-bottom:22px}
 table{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 12px 34px rgba(160,60,100,.12)}
 th{background:#fce4ee;text-align:left;padding:13px 14px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#a3446e}
 td{padding:13px 14px;border-top:1px solid #f6e9ee;font-size:14px}
 tr:hover td{background:#fffafc}
 .dim{color:#a98da0;font-size:12.5px}
 a{color:#e0357f}
</style></head><body><div class="wrap">
<h1>🎂 Birthday treat responses</h1>
<div class="meta">${rows.length} response${rows.length === 1 ? '' : 's'} · storage: <b>${store.mode}</b> · <a href="/api/responses${ADMIN_KEY ? '?key=' + encodeURIComponent(ADMIN_KEY) : ''}">JSON</a></div>
<table><thead><tr><th>#</th><th>Name</th><th>Day</th><th>Time</th><th>Food</th><th>Submitted</th></tr></thead>
<tbody>${body}</tbody></table>
</div></body></html>`);
});

app.listen(PORT, () => {
  console.log(`\n  🎂 Treat site running → http://localhost:${PORT}`);
  console.log(`  📋  Responses        → http://localhost:${PORT}/admin${ADMIN_KEY ? '?key=' + ADMIN_KEY : ''}`);
  console.log(`  💾  Storage mode     → ${store.mode}\n`);
});
