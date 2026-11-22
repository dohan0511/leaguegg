const ACCOUNT_HOST = 'https://asia.api.riotgames.com';
const MATCH_HOST = 'https://asia.api.riotgames.com';
const PLATFORM_HOST = 'https://kr.api.riotgames.com';

function getApiKey() {
  const key = process.env.RIOT_API_KEY;
  if (!key) {
    throw new Error('환경 변수 RIOT_API_KEY가 설정되어 있지 않습니다.');
  }
  return key;
}

async function riotFetch(url) {
  const res = await fetch(url, {
    headers: {
      'X-Riot-Token': getApiKey(),
    },
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Riot API 요청 실패 (${res.status}): ${bodyText || res.statusText}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// "이름#태그" 문자열 파싱
function parseRiotId(riotId) {
  if (!riotId || !riotId.includes('#')) {
    throw new Error('Riot ID는 "게임이름#태그라인" 형식이어야 합니다. (예: Player#KR1)');
  }
  const idx = riotId.lastIndexOf('#');
  const gameName = riotId.slice(0, idx).trim();
  const tagLine = riotId.slice(idx + 1).trim();
  if (!gameName || !tagLine) {
    throw new Error('게임이름과 태그라인을 모두 입력해야 합니다.');
  }
  return { gameName, tagLine };
}

// Riot ID -> PUUID 및 소환사 레벨 조회
async function fetchPlayerProfileByRiotId(riotId) {
  const { gameName, tagLine } = parseRiotId(riotId);

  const account = await riotFetch(
    `${ACCOUNT_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );

  let summonerLevel = 1;
  try {
    const summoner = await riotFetch(
      `${PLATFORM_HOST}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`
    );
    if (typeof summoner.summonerLevel === 'number') {
      summonerLevel = summoner.summonerLevel;
    }
  } catch (_) {
    // 소환사 조회 실패 시 기본 레벨 유지
  }

  return {
    riotId: `${account.gameName}#${account.tagLine}`,
    puuid: account.puuid,
    playerLevel: summonerLevel,
  };
}

// PUUID 기준 최근 매치 ID 목록 조회
async function fetchMatchIdsByPuuid(puuid, count = 5) {
  return riotFetch(
    `${MATCH_HOST}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${count}`
  );
}

// 타임스탬프(ms) -> 'YYYY-MM-DD HH:mm:ss' 변환
function formatTimestamp(ms) {
  const date = new Date(ms || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// match-v5 응답 -> DB 스키마(GAME_MATCH + MATCH_PARTICIPANT) 매핑
function normalizeMatchData(matchDto) {
  const info = matchDto.info || {};
  const rawParticipants = Array.isArray(info.participants) ? info.participants : [];

  const match = {
    match_date: formatTimestamp(info.gameStartTimestamp || info.gameCreation),
    game_duration: Number.isFinite(info.gameDuration) ? Math.floor(info.gameDuration) : 0,
    game_mode: info.gameMode || 'UNKNOWN',
  };

  const participants = rawParticipants.map((p) => {
    const riotId = p.riotIdGameName && p.riotIdTagline
      ? `${p.riotIdGameName}#${p.riotIdTagline}`
      : (p.summonerName || p.puuid);

    return {
      player_name: riotId,
      player_level: Number.isFinite(p.summonerLevel) ? p.summonerLevel : 1,
      character_name: p.championName || `CHAMP_${p.championId}`,
      team_side: p.teamId === 100 ? 'BLUE' : p.teamId === 200 ? 'RED' : String(p.teamId ?? 'NONE'),
      kills: Number.isFinite(p.kills) ? p.kills : 0,
      deaths: Number.isFinite(p.deaths) ? p.deaths : 0,
      assists: Number.isFinite(p.assists) ? p.assists : 0,
      result: p.win ? 'WIN' : 'LOSE',
    };
  });

  return { match, participants };
}

module.exports = {
  parseRiotId,
  fetchPlayerProfileByRiotId,
  fetchMatchIdsByPuuid,
  riotFetch,
  MATCH_HOST,
  normalizeMatchData,
};
