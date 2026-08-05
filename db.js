/**
 * Storage layer.
 * Uses Node's built-in SQLite (node:sqlite, Node 22.5+ / 24+) with no native
 * dependencies. If that isn't available, it transparently falls back to a
 * newline-delimited JSON file so the app always works.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'responses.db');
const JSON_FILE = path.join(DATA_DIR, 'responses.jsonl');

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
    )
  `);
  mode = 'sqlite';
} catch (err) {
  console.warn('[db] node:sqlite unavailable (' + err.code + ') — using JSON file storage.');
}

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
    const stmt = db.prepare(
      `INSERT INTO responses (name, date, time, food, user_agent, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
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
  if (!fs.existsSync(JSON_FILE)) return [];
  return fs.readFileSync(JSON_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => JSON.parse(l))
    .reverse();
}

module.exports = { save, list, get mode() { return mode; }, DB_FILE, JSON_FILE };
