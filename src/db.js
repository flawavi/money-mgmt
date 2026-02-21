'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'money-mgmt.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    plaid_account_id TEXT    NOT NULL UNIQUE,
    plaid_item_id    TEXT    NOT NULL,
    name             TEXT    NOT NULL,
    official_name    TEXT,
    type             TEXT    NOT NULL,
    subtype          TEXT,
    mask             TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    plaid_transaction_id TEXT    NOT NULL UNIQUE,
    account_id           INTEGER NOT NULL REFERENCES accounts(id),
    amount               REAL    NOT NULL,
    date                 TEXT    NOT NULL,
    name                 TEXT    NOT NULL,
    merchant_name        TEXT,
    category             TEXT,
    pending              INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS held_funds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    card_account_id INTEGER NOT NULL REFERENCES accounts(id),
    amount          REAL    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'held'
                            CHECK (status IN ('held', 'transferred', 'released')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transfer_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    held_fund_id     INTEGER NOT NULL REFERENCES held_funds(id),
    from_account_id  INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id    INTEGER NOT NULL REFERENCES accounts(id),
    amount           REAL    NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'posted', 'failed', 'cancelled')),
    plaid_transfer_id TEXT,
    initiated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT
  );
`);

module.exports = db;
