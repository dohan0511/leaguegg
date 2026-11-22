const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbDir = __dirname;
const dbPath = path.join(dbDir, 'leaguegg.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS PLAYER (
    player_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name  TEXT NOT NULL UNIQUE,
    player_level INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS GAME_CHARACTER (
    character_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    character_name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS GAME_MATCH (
    match_id      TEXT PRIMARY KEY,
    match_date    TEXT NOT NULL,
    game_duration INTEGER NOT NULL,
    game_mode     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS MATCH_PARTICIPANT (
    match_id     TEXT NOT NULL,
    player_id    INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    team_side    TEXT NOT NULL,
    kills        INTEGER NOT NULL DEFAULT 0,
    deaths       INTEGER NOT NULL DEFAULT 0,
    assists      INTEGER NOT NULL DEFAULT 0,
    result       TEXT NOT NULL CHECK (result IN ('WIN', 'LOSE')),
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id) REFERENCES GAME_MATCH(match_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES PLAYER(player_id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES GAME_CHARACTER(character_id)
  );
`);

module.exports = db;