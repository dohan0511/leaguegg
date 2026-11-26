const express = require('express');
const db = require('../db/database');
const { saveNormalizedMatches } = require('../services/matchStorage');
const {
    fetchPlayerProfileByRiotId,
    fetchMatchIdsByPuuid,
    riotFetch,
    MATCH_HOST,
    normalizeMatchData,
} = require('../services/riotApi');

const router = express.Router();

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
            saveNormalizedMatches([normalized]);

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
