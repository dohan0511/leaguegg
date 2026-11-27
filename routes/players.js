const express = require('express');
const db = require('../db/database');
const {
    fetchPlayerProfileByRiotId,
    fetchMatchIdsByPuuid,
    riotFetch,
    MATCH_HOST,
    normalizeMatchData,
} = require('../services/riotApi');
const { saveNormalizedMatches } = require('../services/matchStorage');

const router = express.Router();
const MAX_STATS_MATCH_COUNT = 50;

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

const findRecentMatchesStmt = db.prepare(`
    SELECT
        gm.match_id,
        gm.match_date,
        gm.game_duration,
        gm.game_mode,
        gc.character_id,
        gc.character_name,
        mp.team_side,
        mp.kills,
        mp.deaths,
        mp.assists,
        mp.result
    FROM MATCH_PARTICIPANT mp
    JOIN GAME_MATCH gm ON gm.match_id = mp.match_id
    JOIN GAME_CHARACTER gc ON gc.character_id = mp.character_id
    WHERE mp.player_id = ?
    ORDER BY gm.match_date DESC, gm.match_id DESC
    LIMIT ?
`);

const findCharacterStatsStmt = db.prepare(`
    SELECT
        gc.character_id,
        gc.character_name,
        COUNT(*) AS match_count,
        SUM(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN mp.result = 'LOSE' THEN 1 ELSE 0 END) AS losses,
        ROUND(
            100.0 * SUM(CASE WHEN mp.result = 'WIN' THEN 1 ELSE 0 END) / COUNT(*),
            2
        ) AS win_rate
    FROM MATCH_PARTICIPANT mp
    JOIN GAME_CHARACTER gc ON gc.character_id = mp.character_id
    WHERE mp.player_id = ?
    GROUP BY gc.character_id, gc.character_name
    ORDER BY match_count DESC, gc.character_name ASC
`);

const findCachedMatchForPlayerStmt = db.prepare(`
    SELECT gm.match_date
    FROM GAME_MATCH gm
    JOIN MATCH_PARTICIPANT mp ON mp.match_id = gm.match_id
    WHERE gm.match_id = ?
        AND mp.player_id = ?
`);

// LIKE 검색에서 와일드카드 문자를 일반 문자로 처리하도록 이스케이프합니다.
function escapeLikePattern(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

// Riot 프로필을 PLAYER에 생성하거나 기존 레벨을 갱신합니다.
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

// DB 캐시에서 통계를 계산하고 캐시 응답 형식으로 구성합니다.
function createCachedStatsResponse(player, matches, requestedCount, warning) {
    const matchIds = matches.map((match) => match.match_id);
    let aggregate = { match_count: 0, wins: 0, losses: 0 };

    if (matchIds.length > 0) {
        const placeholders = matchIds.map(() => '?').join(', ');
        aggregate = db.prepare(`
            SELECT
                COUNT(*) AS match_count,
                COALESCE(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END), 0) AS wins,
                COALESCE(SUM(CASE WHEN result = 'LOSE' THEN 1 ELSE 0 END), 0) AS losses
            FROM MATCH_PARTICIPANT
            WHERE player_id = ?
                AND match_id IN (${placeholders})
        `).get(player.player_id, ...matchIds);
    }

    const winRate = aggregate.match_count === 0
        ? 0
        : Number(((aggregate.wins / aggregate.match_count) * 100).toFixed(2));
    const oldestMatch = matches[matches.length - 1];
    const oldestMatchTimestamp = oldestMatch
        ? Date.parse(oldestMatch.match_date.replace(' ', 'T'))
        : null;
    const isComplete = matches.length >= requestedCount;
    const response = {
        player,
        stats: {
            match_count: aggregate.match_count,
            wins: aggregate.wins,
            losses: aggregate.losses,
            win_rate: winRate,
        },
        data_window: {
            requested_matches: requestedCount,
            fetched_matches: matches.length,
            api_match_details_fetched: 0,
            database_match_details_reused: matches.length,
            source: 'database',
            complete: isComplete,
            next_count: isComplete
                ? (requestedCount < MAX_STATS_MATCH_COUNT ? requestedCount + 10 : null)
                : requestedCount,
            oldest_match_timestamp: Number.isFinite(oldestMatchTimestamp)
                ? oldestMatchTimestamp
                : null,
            oldest_match_date: Number.isFinite(oldestMatchTimestamp)
                ? new Date(oldestMatchTimestamp).toISOString()
                : null,
        },
    };

    if (warning) {
        response.warning = warning;
    }

    return response;
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

// FR-05: 저장된 게임 기록을 기준으로 플레이어의 최근 전적 조회
router.get('/:playerId/recent', (req, res) => {
    const playerId = Number(req.params.playerId);
    const requestedCount = Number(req.query.count || 10);

    if (!Number.isInteger(playerId) || playerId <= 0) {
        return res.status(400).json({
            error: '유효한 playerId를 입력하세요.',
        });
    }

    if (!Number.isInteger(requestedCount) || requestedCount < 1) {
        return res.status(400).json({
            error: 'count는 1 이상의 정수여야 합니다.',
        });
    }

    const player = findPlayerByIdStmt.get(playerId);
    if (!player) {
        return res.status(404).json({
            error: '해당 플레이어를 찾을 수 없습니다.',
        });
    }

    const safeCount = Math.min(requestedCount, 50);
    const matches = findRecentMatchesStmt.all(playerId, safeCount);

    return res.json({
        player,
        count: matches.length,
        matches,
    });
});

// FR-07: 최근 10게임을 수집한 뒤 해당 범위의 전적 통계를 조회
router.get('/:playerId/stats', async (req, res) => {
    const playerId = Number(req.params.playerId);
    const requestedCount = req.query.count === undefined
        ? 10
        : Number(req.query.count);

    if (!Number.isInteger(playerId) || playerId <= 0) {
        return res.status(400).json({
            error: '유효한 playerId를 입력하세요.',
        });
    }

    if (!Number.isInteger(requestedCount) ||
        requestedCount < 10 ||
        requestedCount > MAX_STATS_MATCH_COUNT ||
        requestedCount % 10 !== 0) {
        return res.status(400).json({
            error: `count는 10부터 ${MAX_STATS_MATCH_COUNT}까지 10의 배수로 입력하세요.`,
        });
    }

    const storedPlayer = findPlayerByIdStmt.get(playerId);
    if (!storedPlayer) {
        return res.status(404).json({
            error: '해당 플레이어를 찾을 수 없습니다.',
        });
    }

    const storedMatches = findRecentMatchesStmt.all(playerId, requestedCount);
    if (storedMatches.length >= requestedCount) {
        return res.json(createCachedStatsResponse(
            storedPlayer,
            storedMatches,
            requestedCount
        ));
    }

    let statsPlayer = storedPlayer;
    const normalizedMatches = [];

    try {
        const profile = await fetchPlayerProfileByRiotId(storedPlayer.player_name);
        statsPlayer = upsertPlayer(profile).player;
        const matchIds = await fetchMatchIdsByPuuid(profile.puuid, requestedCount);

        if (!Array.isArray(matchIds) || matchIds.some((matchId) => typeof matchId !== 'string' || !matchId)) {
            const error = new Error('Riot API의 게임 목록 응답이 올바르지 않습니다.');
            error.status = 502;
            throw error;
        }

        let oldestMatchTimestamp = null;
        let cachedMatches = 0;

        for (const riotMatchId of matchIds) {
            const cachedMatch = findCachedMatchForPlayerStmt.get(
                riotMatchId,
                statsPlayer.player_id
            );

            if (cachedMatch) {
                const timestamp = Date.parse(cachedMatch.match_date.replace(' ', 'T'));
                if (Number.isFinite(timestamp) &&
                    (oldestMatchTimestamp === null || timestamp < oldestMatchTimestamp)) {
                    oldestMatchTimestamp = timestamp;
                }
                cachedMatches += 1;
                continue;
            }

            const matchDto = await riotFetch(
                `${MATCH_HOST}/lol/match/v5/matches/${encodeURIComponent(riotMatchId)}`
            );
            const info = matchDto.info || {};
            const rawParticipants = info.participants;
            // PUUID가 요청한 플레이어와 일치하는 참가자 인덱스를 찾습니다.
            const targetParticipantIndex = Array.isArray(rawParticipants)
                ? rawParticipants.findIndex((participant) => participant.puuid === profile.puuid)
                : -1;

            if (targetParticipantIndex < 0) {
                const error = new Error(`게임 ${riotMatchId}에서 요청 플레이어를 찾을 수 없습니다.`);
                error.status = 502;
                throw error;
            }

            const normalized = normalizeMatchData(matchDto);
            normalized.match.match_id = riotMatchId;
            normalized.participants[targetParticipantIndex].player_name = profile.riotId;
            normalizedMatches.push(normalized);

            const rawTimestamp = info.gameStartTimestamp || info.gameCreation;
            const timestamp = Number(rawTimestamp);
            if (Number.isFinite(timestamp) &&
                (oldestMatchTimestamp === null || timestamp < oldestMatchTimestamp)) {
                oldestMatchTimestamp = timestamp;
            }
        }

        if (normalizedMatches.length > 0) {
            saveNormalizedMatches(normalizedMatches);
        }

        let aggregate = { match_count: 0, wins: 0, losses: 0 };
        if (matchIds.length > 0) {
            const placeholders = matchIds.map(() => '?').join(', ');
            aggregate = db.prepare(`
                SELECT
                    COUNT(*) AS match_count,
                    COALESCE(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END), 0) AS wins,
                    COALESCE(SUM(CASE WHEN result = 'LOSE' THEN 1 ELSE 0 END), 0) AS losses
                FROM MATCH_PARTICIPANT
                WHERE player_id = ?
                    AND match_id IN (${placeholders})
            `).get(statsPlayer.player_id, ...matchIds);
        }

        const winRate = aggregate.match_count === 0
            ? 0
            : Number(((aggregate.wins / aggregate.match_count) * 100).toFixed(2));

        return res.json({
            player: statsPlayer,
            stats: {
                match_count: aggregate.match_count,
                wins: aggregate.wins,
                losses: aggregate.losses,
                win_rate: winRate,
            },
            data_window: {
                requested_matches: requestedCount,
                fetched_matches: matchIds.length,
                api_match_details_fetched: normalizedMatches.length,
                database_match_details_reused: cachedMatches,
                source: 'riot+database',
                complete: true,
                next_count: matchIds.length === requestedCount &&
                    requestedCount < MAX_STATS_MATCH_COUNT
                    ? requestedCount + 10
                    : null,
                oldest_match_timestamp: oldestMatchTimestamp,
                oldest_match_date: oldestMatchTimestamp === null
                    ? null
                    : new Date(oldestMatchTimestamp).toISOString(),
            },
        });
    } catch (err) {
        const status = err.status >= 400 && err.status < 600 ? err.status : 500;

        if (status === 429) {
            try {
                if (normalizedMatches.length > 0) {
                    saveNormalizedMatches(normalizedMatches);
                }

                const availableMatches = findRecentMatchesStmt.all(
                    statsPlayer.player_id,
                    requestedCount
                );
                if (availableMatches.length > 0) {
                    return res.json(createCachedStatsResponse(
                        statsPlayer,
                        availableMatches,
                        requestedCount,
                        'Riot API 요청 제한으로 저장된 전적만 반환했습니다. 잠시 후 다시 요청하세요.'
                    ));
                }
            } catch (cacheError) {
                return res.status(500).json({ error: cacheError.message });
            }
        }

        return res.status(status).json({ error: err.message });
    }
});

// FR-08: DB에 저장된 플레이어의 캐릭터별 게임 수와 승률을 조회합니다.
router.get('/:playerId/characters', (req, res) => {
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

    const characters = findCharacterStatsStmt.all(playerId);
    return res.json({
        player,
        count: characters.length,
        characters,
    });
});

module.exports = router;
