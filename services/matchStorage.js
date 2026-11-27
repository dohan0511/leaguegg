const db = require('../db/database');

const findPlayerByNameStmt = db.prepare(`
    SELECT player_id
    FROM PLAYER
    WHERE player_name = ?
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

const insertCharacterStmt = db.prepare(`
    INSERT OR IGNORE INTO GAME_CHARACTER (character_name)
    VALUES (?)
`);
const findCharacterByNameStmt = db.prepare(`
    SELECT character_id
    FROM GAME_CHARACTER
    WHERE character_name = ?
`);

const insertMatchStmt = db.prepare(`
    INSERT OR IGNORE INTO GAME_MATCH (
        match_id, match_date, game_duration, game_mode
    ) VALUES (?, ?, ?, ?)
`);
const insertParticipantStmt = db.prepare(`
    INSERT OR IGNORE INTO MATCH_PARTICIPANT (
        match_id, player_id, character_id, team_side, kills, deaths, assists, result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// 플레이어를 이름으로 찾고 없으면 생성하며, 기존 레벨은 더 큰 값으로 갱신합니다.
function getOrCreatePlayerId(playerName, playerLevel) {
    const existing = findPlayerByNameStmt.get(playerName);
    if (existing) {
        updatePlayerLevelStmt.run(playerLevel, existing.player_id);
        return existing.player_id;
    }

    return insertPlayerStmt.run(playerName, playerLevel).lastInsertRowid;
}

// 캐릭터가 없으면 생성하고 해당 캐릭터 ID를 반환합니다.
function getOrCreateCharacterId(characterName) {
    insertCharacterStmt.run(characterName);
    return findCharacterByNameStmt.get(characterName).character_id;
}

// 정규화된 게임과 모든 참가자 정보를 데이터베이스에 기록합니다.
function saveNormalizedMatch({ match, participants }) {
    const matchId = match.match_id;

    insertMatchStmt.run(
        matchId,
        match.match_date,
        match.game_duration,
        match.game_mode
    );

    for (const participant of participants) {
        const playerId = getOrCreatePlayerId(
            participant.player_name,
            participant.player_level
        );
        const characterId = getOrCreateCharacterId(participant.character_name);

        insertParticipantStmt.run(
            matchId,
            playerId,
            characterId,
            participant.team_side,
            participant.kills,
            participant.deaths,
            participant.assists,
            participant.result
        );
    }
}

// 여러 게임을 하나의 트랜잭션으로 저장해 중간 실패 시 전체 변경을 취소합니다.
const saveNormalizedMatchesTx = db.transaction((matches) => {
    for (const match of matches) {
        saveNormalizedMatch(match);
    }
});

// 게임 저장 트랜잭션을 실행하는 외부 호출용 함수입니다.
function saveNormalizedMatches(matches) {
    return saveNormalizedMatchesTx(matches);
}

module.exports = { saveNormalizedMatches };
