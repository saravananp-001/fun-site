const express = require('express');
const path = require('path');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
// Behind nginx, bind to loopback only so the Node port isn't reachable from outside.
// Set HOST=0.0.0.0 to expose it directly.
const HOST = process.env.HOST || '127.0.0.1';

// Change this to protect /admin. Set ADMIN_KEY env var, or leave blank for open access.
const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true);

const meta = (req) => ({
  user_agent: (req.get('user-agent') || '').slice(0, 300),
  ip: req.ip,
});

/* ---------- track every step ---------- */
app.post('/api/event', (req, res) => {
  const { session, step, detail, name } = req.body || {};
  if (!session || !step) return res.status(400).json({ error: 'session and step required' });

  try {
    const saved = store.saveEvent({ session, name, step, detail, ...meta(req) });
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

/* ---------- wipe data (POST only, key required) ---------- */
app.post('/api/clear', guard, (req, res) => {
  const what = (req.body && req.body.what) || 'all';
  if (!['all', 'events', 'responses'].includes(what)) {
    return res.status(400).json({ error: "what must be 'all', 'events' or 'responses'" });
  }
  try {
    const removed = store.clear(what);
    console.log(`🧹 cleared ${what} — ${removed.responses} responses, ${removed.events} events`);
    res.json({ ok: true, what, removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'could not clear' });
  }
});

app.get('/api/responses', guard, (req, res) => res.json(store.list()));
app.get('/api/events',    guard, (req, res) => res.json(store.listEvents(1000)));
app.get('/api/funnel',    guard, (req, res) =>
  res.json({ funnel: store.funnel(), sessions: store.sessions() })
);

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * Turn a raw user-agent string into something readable, e.g.
 *   "iPhone · WhatsApp"   "Android · Chrome"   "Mac · Safari"
 * Deliberately small — no dependency, no fingerprinting.
 */
function parseUA(ua = '') {
  const s = String(ua);
  if (!s) return { device: 'unknown', icon: '❓' };

  let device = 'Unknown', icon = '💻';
  if (/iPhone/i.test(s))                    { device = 'iPhone';  icon = '📱'; }
  else if (/iPad/i.test(s))                 { device = 'iPad';    icon = '📱'; }
  else if (/Android/i.test(s))              { device = /Mobile/i.test(s) ? 'Android' : 'Android tablet'; icon = '📱'; }
  else if (/Macintosh|Mac OS X/i.test(s))   { device = 'Mac';     icon = '💻'; }
  else if (/Windows/i.test(s))              { device = 'Windows'; icon = '🖥️'; }
  else if (/CrOS/i.test(s))                 { device = 'ChromeOS';icon = '💻'; }
  else if (/Linux/i.test(s))                { device = 'Linux';   icon = '💻'; }
  else if (/curl|node|python|bot|spider/i.test(s)) { device = 'Bot/script'; icon = '🤖'; }

  // In-app browsers matter here — most people will open this from a chat app.
  let browser = '';
  if (/FBAN|FBAV/i.test(s))            browser = 'Facebook';
  else if (/Instagram/i.test(s))       browser = 'Instagram';
  else if (/WhatsApp/i.test(s))        browser = 'WhatsApp';
  else if (/Line\//i.test(s))          browser = 'LINE';
  else if (/SnapChat/i.test(s))        browser = 'Snapchat';
  else if (/Telegram/i.test(s))        browser = 'Telegram';
  else if (/EdgA?\//i.test(s))         browser = 'Edge';
  else if (/SamsungBrowser/i.test(s))  browser = 'Samsung';
  else if (/OPR\/|Opera/i.test(s))     browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(s))   browser = 'Firefox';
  else if (/CriOS|Chrome/i.test(s))    browser = 'Chrome';
  else if (/Safari/i.test(s))          browser = 'Safari';
  else if (/curl/i.test(s))            browser = 'curl';

  return { device, icon, browser, label: browser ? `${device} · ${browser}` : device };
}

/** Trim IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4) for readability. */
const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '') || '—';

const deviceCell = (ua, ip) => {
  const p = parseUA(ua);
  return `<td><span title="${esc(ua)}">${p.icon} ${esc(p.label)}</span>
    <div class="dim mono">${esc(cleanIp(ip))}</div></td>`;
};

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
      <td>${s.name ? '<b>' + esc(s.name) + '</b>' : '<span class="mono dim">' + esc(s.session).slice(0, 10) + '</span>'}</td>
      ${deviceCell(s.user_agent, s.ip)}
      <td><b>${esc(labelOf[s.furthest] || s.furthest)}</b></td>
      <td class="num">${s.stepCount}</td>
      <td class="dim">${new Date(s.first).toLocaleString()}</td>
      <td class="dim">${new Date(s.last).toLocaleString()}</td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No visits yet</td></tr>';

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
      ${deviceCell(r.user_agent, r.ip)}
      <td class="dim">${new Date(r.created_at).toLocaleString()}</td>
    </tr>`;
  }).join('')
    : '<tr><td colspan="7" class="empty">No responses yet 🎂</td></tr>';

  // A visitor may only reveal their name partway through; show it on every
  // row of that session once we know it.
  const nameBySession = {};
  for (const s of sess) if (s.name) nameBySession[s.session] = s.name;

  const nameCell = (e) => {
    const n = e.name || nameBySession[e.session];
    return n
      ? `<td><b>${esc(n)}</b></td>`
      : `<td class="mono dim">${esc(e.session).slice(0, 10)}</td>`;
  };

  const eventRows = events.length ? events.map((e) => `<tr>
      ${nameCell(e)}
      ${deviceCell(e.user_agent, e.ip)}
      <td>${esc(labelOf[e.step] || e.step)}</td>
      <td class="dim">${esc(e.detail) || ''}</td>
      <td class="dim">${new Date(e.created_at).toLocaleString()}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" class="empty">No events yet</td></tr>';

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
 .danger{margin-top:38px;background:#fff;border:1px solid #f3d3de;border-radius:14px;padding:16px 18px}
 .danger h3{margin:0 0 3px;font-family:Georgia,serif;font-size:15px;font-weight:600}
 .danger p{margin:0 0 13px;font-size:12.5px;color:#a98da0}
 .danger .row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
 .wipe{font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;padding:9px 15px;
   border-radius:9px;border:1px solid #e6c4d2;background:#fff;color:#8a5468;transition:.15s}
 .wipe:hover{border-color:#e0357f;color:#e0357f;background:#fff6f9}
 .wipe.all{background:#c0245c;border-color:#c0245c;color:#fff}
 .wipe.all:hover{background:#a11c4c;color:#fff}
 .wipe:disabled{opacity:.5;cursor:not-allowed}
 #wipeMsg{font-size:12.5px;margin-left:4px}
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
<table><thead><tr><th>#</th><th>Name</th><th>Day</th><th>Time</th><th>Food</th><th>Device / IP</th><th>Submitted</th></tr></thead>
<tbody>${respRows}</tbody></table>

<h2>Visitors</h2>
<table><thead><tr><th>Who</th><th>Device / IP</th><th>Got as far as</th><th class="num">Steps</th><th>First seen</th><th>Last seen</th></tr></thead>
<tbody>${sessRows}</tbody></table>

<h2>Recent activity</h2>
<table><thead><tr><th>Who</th><th>Device / IP</th><th>Step</th><th>Detail</th><th>When</th></tr></thead>
<tbody>${eventRows}</tbody></table>

<div class="danger">
  <h3>Clear stored data</h3>
  <p>Permanent — there's no undo. Use this to reset before sharing the link for real.</p>
  <div class="row">
    <button class="wipe" data-what="events">Clear tracking events (${events.length >= 150 ? '150+' : events.length})</button>
    <button class="wipe" data-what="responses">Clear responses (${rows.length})</button>
    <button class="wipe all" data-what="all">Clear everything</button>
    <span id="wipeMsg"></span>
  </div>
</div>

<script>
const KEY = ${JSON.stringify(req.query.key || '')};
const msg = document.getElementById('wipeMsg');
const LABEL = { events:'tracking events', responses:'responses', all:'ALL data (responses + events)' };

document.querySelectorAll('.wipe').forEach(btn => {
  btn.onclick = async () => {
    const what = btn.dataset.what;
    if (!confirm('Delete ' + LABEL[what] + '?\\n\\nThis cannot be undone.')) return;
    if (what === 'all' && !confirm('Really wipe everything? Last chance.')) return;

    document.querySelectorAll('.wipe').forEach(b => b.disabled = true);
    msg.style.color = '#a98da0'; msg.textContent = 'clearing…';
    try {
      const r = await fetch('/api/clear' + (KEY ? '?key=' + encodeURIComponent(KEY) : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ what })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      msg.style.color = '#2e8b57';
      msg.textContent = 'Removed ' + j.removed.responses + ' responses, ' + j.removed.events + ' events. Reloading…';
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      document.querySelectorAll('.wipe').forEach(b => b.disabled = false);
      msg.style.color = '#c0245c';
      msg.textContent = 'Failed: ' + e.message;
    }
  };
});
</script>
</div></body></html>`);
});

app.listen(PORT, HOST, () => {
  console.log(`\n  🎂 Treat site running → http://${HOST}:${PORT}`);
  console.log(`  📊 Dashboard          → http://${HOST}:${PORT}/admin${ADMIN_KEY ? '?key=' + ADMIN_KEY : ''}`);
  console.log(`  💾 Storage mode       → ${store.mode}`);
  console.log(`  📁 Data directory     → ${path.dirname(store.DB_FILE)}\n`);
});
