/**
 * db.js
 * 
 * Persistencia liviana con better-sqlite3 (síncrono, sin config).
 * Guarda: ranking de jugadores, historial de partidas.
 * 
 * Si better-sqlite3 no está instalado, el módulo falla silenciosamente
 * y el juego sigue funcionando sin persistencia (graceful degradation).
 */

let db = null;

function initDB() {
  try {
    const Database = require('better-sqlite3');
    db = new Database('./brawlbots.db');

    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS players (
        nickname    TEXT PRIMARY KEY,
        wins        INTEGER DEFAULT 0,
        losses      INTEGER DEFAULT 0,
        eliminations INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS matches (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        winner      TEXT,
        players     TEXT,   -- JSON array de nicknames
        duration_ms INTEGER,
        map_key     TEXT,
        played_at   TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_players_wins ON players(wins DESC);
    `);

    console.log('[DB] SQLite iniciado → brawlbots.db');
    return true;
  } catch (err) {
    console.warn('[DB] Sin persistencia (instalar better-sqlite3 para activar):', err.message);
    db = null;
    return false;
  }
}

// ─── Guardar resultado de partida ─────────────────────────────────────────────

function saveMatchResult({ winner, players, durationMs, mapKey }) {
  if (!db) return;
  try {
    const insertMatch = db.prepare(`
      INSERT INTO matches (winner, players, duration_ms, map_key)
      VALUES (?, ?, ?, ?)
    `);
    const upsertPlayer = db.prepare(`
      INSERT INTO players (nickname, wins, losses, eliminations, games_played)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(nickname) DO UPDATE SET
        wins         = wins + excluded.wins,
        losses       = losses + excluded.losses,
        eliminations = eliminations + excluded.eliminations,
        games_played = games_played + 1
    `);

    const transaction = db.transaction(() => {
      const nicknames = players.map(p => p.nickname);
      insertMatch.run(winner?.nickname || null, JSON.stringify(nicknames), durationMs, mapKey);

      for (const p of players) {
        if (p.nickname.startsWith('[BOT]')) continue; // no guardar bots
        const isWinner = winner && p.nickname === winner.nickname;
        upsertPlayer.run(p.nickname, isWinner ? 1 : 0, isWinner ? 0 : 1, p.eliminations || 0);
      }
    });

    transaction();
  } catch (err) {
    console.error('[DB] Error guardando partida:', err.message);
  }
}

// ─── Obtener leaderboard ──────────────────────────────────────────────────────

function getLeaderboard(limit = 20) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT nickname, wins, losses, eliminations, games_played,
             ROUND(CAST(wins AS FLOAT) / MAX(games_played, 1) * 100, 1) AS win_rate
      FROM players
      WHERE games_played > 0
      ORDER BY wins DESC, eliminations DESC
      LIMIT ?
    `).all(limit);
  } catch (err) {
    console.error('[DB] Error leyendo leaderboard:', err.message);
    return [];
  }
}

// ─── Obtener stats de un jugador ──────────────────────────────────────────────

function getPlayerStats(nickname) {
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM players WHERE nickname = ?').get(nickname);
  } catch {
    return null;
  }
}

// ─── Últimas partidas ─────────────────────────────────────────────────────────

function getRecentMatches(limit = 10) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT winner, players, duration_ms, map_key, played_at
      FROM matches ORDER BY id DESC LIMIT ?
    `).all(limit).map(row => ({
      ...row,
      players: JSON.parse(row.players)
    }));
  } catch {
    return [];
  }
}

module.exports = { initDB, saveMatchResult, getLeaderboard, getPlayerStats, getRecentMatches };
