/**
 * Storage layer.
 * Uses Node's built-in SQLite (node:sqlite, Node 22.5+ / 24+) with no native
 * dependencies. If that isn't available, it transparently falls back to
 * newline-delimited JSON files so the app always works.
 *
 * Two tables:
 *   responses — the final confirmed treat (one row per accept)
 *   events    — every step a visitor reaches, so you can see the funnel
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'responses.db');
const JSON_FILE = path.join(DATA_DIR, 'responses.jsonl');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');

/** The funnel, in order. Anything not in this list still gets stored. */
const STEPS = [
  ['visit',       'Opened the page'],
  ['no_dodge',    'Tried to click "no"'],
  ['yes',         'Clicked YES'],
  ['intro_done',  'Past the surprise screen'],
  ['date_time',   'Picked day + time'],
  ['food',        'Picked food'],
  ['accepted',    'Hit "I accept" (saved)'],
];

let mode = 'json';
let db = null;

try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS responses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      date       TEXT NOT NULL,
      time       TEXT NOT NULL,
      food       TEXT NOT NULL,
      user_agent TEXT,
      ip         TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session    TEXT NOT NULL,
      step       TEXT NOT NULL,
      detail     TEXT,
      user_agent TEXT,
      ip         TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session);
    CREATE INDEX IF NOT EXISTS idx_events_step    ON events(step);
  `);
  mode = 'sqlite';
} catch (err) {
  console.warn('[db] node:sqlite unavailable (' + err.code + ') — using JSON file storage.');
}

/* ------------------------------------------------------------------ */
/* responses                                                           */
/* ------------------------------------------------------------------ */

function save(row) {
  const record = {
    name: row.name || null,
    date: row.date,
    time: row.time,
    food: row.food,
    user_agent: row.user_agent || null,
    ip: row.ip || null,
    created_at: new Date().toISOString(),
  };

  if (mode === 'sqlite') {
    const info = db.prepare(
      `INSERT INTO responses (name, date, time, food, user_agent, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.name, record.date, record.time, record.food,
      record.user_agent, record.ip, record.created_at
    );
    return { id: Number(info.lastInsertRowid), ...record };
  }

  const all = list();
  record.id = all.length ? all[0].id + 1 : 1;
  fs.appendFileSync(JSON_FILE, JSON.stringify(record) + '\n');
  return record;
}

function list() {
  if (mode === 'sqlite') {
    return db.prepare('SELECT * FROM responses ORDER BY id DESC').all();
  }
  return readJsonl(JSON_FILE).reverse();
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

function saveEvent(row) {
  const record = {
    session: String(row.session || 'unknown').slice(0, 40),
    step: String(row.step || 'unknown').slice(0, 40),
    detail: row.detail == null ? null : String(row.detail).slice(0, 300),
    user_agent: row.user_agent || null,
    ip: row.ip || null,
    created_at: new Date().toISOString(),
  };

  if (mode === 'sqlite') {
    const info = db.prepare(
      `INSERT INTO events (session, step, detail, user_agent, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      record.session, record.step, record.detail,
      record.user_agent, record.ip, record.created_at
    );
    return { id: Number(info.lastInsertRowid), ...record };
  }

  const all = readJsonl(EVENTS_FILE);
  record.id = all.length + 1;
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + '\n');
  return record;
}

function listEvents(limit = 300) {
  if (mode === 'sqlite') {
    return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
  }
  return readJsonl(EVENTS_FILE).reverse().slice(0, limit);
}

/** How many distinct people reached each step. */
function funnel() {
  let counts = {};
  if (mode === 'sqlite') {
    for (const r of db.prepare(
      'SELECT step, COUNT(DISTINCT session) AS n FROM events GROUP BY step'
    ).all()) counts[r.step] = r.n;
  } else {
    const seen = {};
    for (const e of readJsonl(EVENTS_FILE)) {
      (seen[e.step] = seen[e.step] || new Set()).add(e.session);
    }
    for (const k in seen) counts[k] = seen[k].size;
  }

  const visits = counts.visit || 0;
  const known = STEPS.map(([step, label]) => ({
    step, label,
    count: counts[step] || 0,
    pct: visits ? Math.round(((counts[step] || 0) / visits) * 100) : 0,
  }));
  const extra = Object.keys(counts)
    .filter((s) => !STEPS.some(([k]) => k === s))
    .map((step) => ({
      step, label: step, count: counts[step],
      pct: visits ? Math.round((counts[step] / visits) * 100) : 0,
    }));

  return [...known, ...extra];
}

/** One row per visitor: how far they got, and when. */
function sessions() {
  const rows = mode === 'sqlite'
    ? db.prepare('SELECT * FROM events ORDER BY id ASC').all()
    : readJsonl(EVENTS_FILE);

  const order = Object.fromEntries(STEPS.map(([s], i) => [s, i]));
  const map = new Map();

  for (const e of rows) {
    let s = map.get(e.session);
    if (!s) {
      s = { session: e.session, first: e.created_at, last: e.created_at,
            steps: new Set(), furthest: e.step, rank: -1, ip: e.ip, user_agent: e.user_agent };
      map.set(e.session, s);
    }
    s.last = e.created_at;
    s.steps.add(e.step);
    const r = order[e.step];
    if (r != null && r > s.rank) { s.rank = r; s.furthest = e.step; }
  }

  return [...map.values()]
    .map((s) => ({ ...s, steps: [...s.steps], stepCount: s.steps.size }))
    .sort((a, b) => (a.last < b.last ? 1 : -1));
}

/* ------------------------------------------------------------------ */

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

module.exports = {
  save, list,
  saveEvent, listEvents, funnel, sessions,
  STEPS,
  get mode() { return mode; },
  DB_FILE, JSON_FILE, EVENTS_FILE,
};
