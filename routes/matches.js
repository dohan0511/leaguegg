const express = require('express');
const db = require('../db/database');
const {
    fetchPlayerProfileByRiotId,
    fetchMatchIdsByPuuid,
    riotFetch,
    MATCH_HOST,
    normalizeMatchData,
} = require('../services/riotApi');

const router = express.Router();

// Prepared Statements
const findPlayerByNameStmt = db.prepare('SELECT player_id, player_level FROM PLAYER WHERE player_name = ?');
const insertPlayerStmt = db.prepare('INSERT INTO PLAYER (player_name, player_level) VALUES (?, ?)');
const updatePlayerLevelStmt = db.prepare('UPDATE PLAYER SET player_level = MAX(player_level, ?) WHERE player_id = ?');

const insertCharacterStmt = db.prepare('INSERT OR IGNORE INTO GAME_CHARACTER (character_name) VALUES (?)');
const findCharacterByNameStmt = db.prepare('SELECT character_id FROM GAME_CHARACTER WHERE character_name = ?');

const insertMatchStmt = db.prepare(
    'INSERT OR IGNORE INTO GAME_MATCH (match_id, match_date, game_duration, game_mode) VALUES (?, ?, ?, ?)'
);

const insertParticipantStmt = db.prepare(`
    INSERT OR IGNORE INTO MATCH_PARTICIPANT (
        match_id, player_id, character_id, team_side, kills, deaths, assists, result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

function getOrCreatePlayerId(playerName, playerLevel) {
    const existing = findPlayerByNameStmt.get(playerName);
    if (existing) {
        updatePlayerLevelStmt.run(playerLevel, existing.player_id);
        return existing.player_id;
    }
    return insertPlayerStmt.run(playerName, playerLevel).lastInsertRowid;
}

function getOrCreateCharacterId(characterName) {
    insertCharacterStmt.run(characterName);
    return findCharacterByNameStmt.get(characterName).character_id;
}

// 한 경기와 참여자 목록을 단일 트랜잭션으로 저장
const saveNormalizedMatchTx = db.transaction(({ match, participants }) => {
    const matchId = match.match_id;

    insertMatchStmt.run(
        matchId,
        match.match_date,
        match.game_duration,
        match.game_mode
    );

    for (const p of participants) {
        const playerId = getOrCreatePlayerId(p.player_name, p.player_level);
        const characterId = getOrCreateCharacterId(p.character_name);

        insertParticipantStmt.run(
            matchId,
            playerId,
            characterId,
            p.team_side,
            p.kills,
            p.deaths,
            p.assists,
            p.result
        );
    }
});

// FR-03 & FR-04: Riot ID 기준 최근 경기 수집 및 DB 저장
router.post('/collect', async (req, res) => {
    try {
        const { riotId, count = 3 } = req.body || {};

        if (typeof riotId !== 'string' || !riotId.includes('#')) {
            return res.status(400).json({
                error: 'Riot ID는 "게임이름#태그라인" 형식이어야 합니다.',
            });
        }

        const safeCount = Math.min(Math.max(Number(count) || 3, 1), 10);

        const profile = await fetchPlayerProfileByRiotId(riotId);
        getOrCreatePlayerId(profile.riotId, profile.playerLevel);

        const matchIds = await fetchMatchIdsByPuuid(profile.puuid, safeCount);
        const savedMatches = [];

        if (!Array.isArray(matchIds)) {
            throw new Error('Riot API의 매치 목록 응답이 올바르지 않습니다.');
        }

        for (const riotMatchId of matchIds) {
            const matchDto = await riotFetch(
                `${MATCH_HOST}/lol/match/v5/matches/${encodeURIComponent(riotMatchId)}`
            );
            const normalized = normalizeMatchData(matchDto);
            normalized.match.match_id = riotMatchId;
            saveNormalizedMatchTx(normalized);

            savedMatches.push({
                match_id: riotMatchId,
                participant_count: normalized.participants.length,
            });
        }

        res.status(201).json({
            player: profile,
            collected_count: savedMatches.length,
            matches: savedMatches,
        });
    } catch (err) {
        const status = err.status >= 400 && err.status < 600 ? err.status : 500;
        res.status(status).json({ error: err.message });
    }
});

// FR-06: 경기 상세 조회 (경기 정보 + 참여자 목록)
router.get('/:matchId', (req, res) => {
    const matchId = req.params.matchId;

    const match = db.prepare(`
        SELECT match_id, match_date, game_duration, game_mode
        FROM GAME_MATCH
        WHERE match_id = ?
    `).get(matchId);

    if (!match) {
        return res.status(404).json({ error: '해당 경기를 찾을 수 없습니다.' });
    }

    const participants = db.prepare(`
        SELECT
            mp.player_id,
            p.player_name,
            p.player_level,
            mp.character_id,
            c.character_name,
            mp.team_side,
            mp.kills,
            mp.deaths,
            mp.assists,
            mp.result
        FROM MATCH_PARTICIPANT mp
        JOIN PLAYER p ON mp.player_id = p.player_id
        JOIN GAME_CHARACTER c ON mp.character_id = c.character_id
        WHERE mp.match_id = ?
        ORDER BY mp.team_side ASC, mp.kills DESC
    `).all(matchId);

    return res.json({ match, participants });
});

module.exports = router;
