const express = require('express');
const db = require('../db/database');
const { fetchPlayerProfileByRiotId } = require('../services/riotApi');

const router = express.Router();

const searchPlayersStmt = db.prepare(`
    SELECT
        player_id,
        player_name,
        player_level
    FROM PLAYER
    WHERE player_name LIKE ? ESCAPE '\\'
    ORDER BY
        CASE WHEN player_name = ? THEN 0 ELSE 1 END,
        player_name ASC
    LIMIT 20
`);

const findPlayerByNameStmt = db.prepare(`
    SELECT player_id, player_name, player_level
    FROM PLAYER
    WHERE player_name = ?
`);

const findPlayerByIdStmt = db.prepare(`
    SELECT player_id, player_name, player_level
    FROM PLAYER
    WHERE player_id = ?
`);

const insertPlayerStmt = db.prepare(`
    INSERT INTO PLAYER (player_name, player_level)
    VALUES (?, ?)
`);

const updatePlayerLevelStmt = db.prepare(`
    UPDATE PLAYER
    SET player_level = MAX(player_level, ?)
    WHERE player_id = ?
`);

function escapeLikePattern(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

function upsertPlayer(profile) {
    const existing = findPlayerByNameStmt.get(profile.riotId);

    if (existing) {
        updatePlayerLevelStmt.run(profile.playerLevel, existing.player_id);
        return {
            player: findPlayerByIdStmt.get(existing.player_id),
            created: false,
        };
    }

    const result = insertPlayerStmt.run(
        profile.riotId,
        profile.playerLevel
    );

    return {
        player: findPlayerByIdStmt.get(result.lastInsertRowid),
        created: true,
    };
}

// FR-01: 플레이어 식별 정보로 저장된 플레이어 검색
router.get('/search', async (req, res) => {
    const query = String(req.query.q || req.query.query || '').trim();

    if (!query) {
        return res.status(400).json({
            error: '검색할 플레이어 이름 또는 Riot ID를 입력하세요.',
        });
    }

    const escapedQuery = escapeLikePattern(query);
    const players = searchPlayersStmt.all(`%${escapedQuery}%`, query);

    if (players.length === 0 && query.includes('#')) {
        try {
            const profile = await fetchPlayerProfileByRiotId(query);
            const saved = upsertPlayer(profile);

            return res.json({
                query,
                count: 1,
                source: 'riot',
                saved: saved.player,
                created: saved.created,
                player: saved.player,
                puuid: profile.puuid,
                players: [saved.player],
            });
        } catch (err) {
            if (err.status >= 400 && err.status < 600) {
                return res.status(err.status).json({ error: err.message });
            }

            return res.status(400).json({ error: err.message });
        }
    }

    return res.json({
        query,
        count: players.length,
        source: 'database',
        players,
    });
});

// FR-02: Riot 프로필 조회 및 PLAYER 테이블 저장/갱신
router.post('/sync', async (req, res) => {
    const { riotId } = req.body || {};

    if (typeof riotId !== 'string' || !riotId.includes('#')) {
        return res.status(400).json({
            error: 'Riot ID는 "게임이름#태그라인" 형식이어야 합니다.',
        });
    }

    try {
        const profile = await fetchPlayerProfileByRiotId(riotId);
        const saved = upsertPlayer(profile);

        return res.status(saved.created ? 201 : 200).json({
            created: saved.created,
            player: saved.player,
            puuid: profile.puuid,
        });
    } catch (err) {
        if (err.status >= 400 && err.status < 600) {
            return res.status(err.status).json({ error: err.message });
        }

        return res.status(400).json({ error: err.message });
    }
});

// FR-02: 저장된 플레이어 정보 조회
router.get('/:playerId', (req, res) => {
    const playerId = Number(req.params.playerId);

    if (!Number.isInteger(playerId) || playerId <= 0) {
        return res.status(400).json({
            error: '유효한 playerId를 입력하세요.',
        });
    }

    const player = findPlayerByIdStmt.get(playerId);

    if (!player) {
        return res.status(404).json({
            error: '해당 플레이어를 찾을 수 없습니다.',
        });
    }

    return res.json({ player });
});

module.exports = router;
