const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'app.db');
const db = new sqlite3.Database(DB_PATH);

// Helper function to run queries with promises
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Initialize tables
async function initDb() {
  await run(`PRAGMA journal_mode = WAL;`);

  // 1. requests table
  await run(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      generation_option TEXT NOT NULL,
      style TEXT NOT NULL,
      status TEXT NOT NULL,
      guardrail_step TEXT,
      blocked_reason TEXT,
      generated_text TEXT,
      generated_image_url TEXT,
      final_text TEXT,
      cost REAL DEFAULT 0.0,
      is_cached INTEGER DEFAULT 0,
      image_prompt TEXT,
      review_feedback TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Index for fast cache lookups and topic repeat tracking
  try {
    await run(`ALTER TABLE requests ADD COLUMN image_prompt TEXT;`);
  } catch (_) {
    // Column already exists
  }

  await run(`
    CREATE INDEX IF NOT EXISTS idx_requests_topic_option ON requests (topic, generation_option, style);
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests (created_at);
  `);

  // 2. usage_log table
  await run(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      image_count INTEGER DEFAULT 0,
      cost REAL DEFAULT 0.0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES requests(id)
    );
  `);

  // 3. daily_spend table
  await run(`
    CREATE TABLE IF NOT EXISTS daily_spend (
      date TEXT PRIMARY KEY,
      total_spend REAL DEFAULT 0.0,
      request_count INTEGER DEFAULT 0,
      blocked_count INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0
    );
  `);

  console.log('[Database] SQLite initialized successfully at', DB_PATH);
}

// Helpers for usage and spend tracking
function getTodayString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

async function getDailySpend(date = getTodayString()) {
  let record = await get(`SELECT * FROM daily_spend WHERE date = ?`, [date]);
  if (!record) {
    await run(
      `INSERT OR IGNORE INTO daily_spend (date, total_spend, request_count, blocked_count, tokens_used) VALUES (?, 0, 0, 0, 0)`,
      [date]
    );
    record = await get(`SELECT * FROM daily_spend WHERE date = ?`, [date]);
  }
  return record || { date, total_spend: 0, request_count: 0, blocked_count: 0, tokens_used: 0 };
}

async function recordUsage({ requestId, provider, model, promptTokens, completionTokens, imageCount, cost }) {
  const totalTokens = (promptTokens || 0) + (completionTokens || 0);
  const today = getTodayString();

  // Log granular usage
  await run(
    `INSERT INTO usage_log (request_id, provider, model, prompt_tokens, completion_tokens, total_tokens, image_count, cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestId, provider, model, promptTokens || 0, completionTokens || 0, totalTokens, imageCount || 0, cost || 0.0]
  );

  // Update aggregated daily spend
  await run(
    `INSERT INTO daily_spend (date, total_spend, request_count, blocked_count, tokens_used)
     VALUES (?, ?, 1, 0, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_spend = total_spend + ?,
       request_count = request_count + 1,
       tokens_used = tokens_used + ?`,
    [today, cost || 0.0, totalTokens, cost || 0.0, totalTokens]
  );
}

async function incrementDailyBlocked(date = getTodayString()) {
  await run(
    `INSERT INTO daily_spend (date, total_spend, request_count, blocked_count, tokens_used)
     VALUES (?, 0, 1, 1, 0)
     ON CONFLICT(date) DO UPDATE SET
       request_count = request_count + 1,
       blocked_count = blocked_count + 1`,
    [date]
  );
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb,
  getDailySpend,
  getTodayString,
  recordUsage,
  incrementDailyBlocked
};
