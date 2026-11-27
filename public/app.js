const searchScreen = document.querySelector('#search-screen');
const profileScreen = document.querySelector('#profile-screen');
const searchForm = document.querySelector('#search-form');
const searchInput = document.querySelector('#player-query');
const searchButton = document.querySelector('#search-submit');
const searchFeedback = document.querySelector('#search-feedback');
const searchResults = document.querySelector('#search-results');
const loadMoreStatsButton = document.querySelector('#load-more-stats');
const matchDialog = document.querySelector('#match-dialog');

let profileRequestId = 0;
let recentMatchesRequestId = 0;
let characterStatsRequestId = 0;
let activePlayerId = null;

// JSON API 응답을 읽고 HTTP 오류를 사용자에게 표시할 수 있는 예외로 변환합니다.
async function requestJson(url) {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || '요청을 처리하지 못했습니다.');
        error.status = response.status;
        throw error;
    }

    return data;
}

// 텍스트를 사용자 입력과 분리해 안전하게 화면에 추가할 요소를 만듭니다.
function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    element.textContent = text ?? '';
    return element;
}

// 메인 검색 화면의 안내 문구와 상태 스타일을 갱신합니다.
function showSearchFeedback(message, isError = false) {
    searchFeedback.textContent = message;
    searchFeedback.classList.toggle('is-error', isError);
}

// 검색 화면과 플레이어 화면 중 하나를 표시합니다.
function showScreen(screenName) {
    const showProfile = screenName === 'profile';
    searchScreen.hidden = showProfile;
    profileScreen.hidden = !showProfile;
}

// URL에서 플레이어 ID를 제거하고 검색 화면으로 돌아갑니다.
function returnToSearch(updateHistory = true) {
    profileRequestId += 1;
    activePlayerId = null;
    showScreen('search');
    showSearchFeedback('');
    searchResults.replaceChildren();
    if (updateHistory) {
        window.history.pushState({}, '', '/');
    }
    searchInput.focus();
}

// Riot ID의 게임 이름 부분과 전체 Riot ID를 플레이어 헤더에 표시합니다.
function renderPlayerInfo(player) {
    const riotId = player.player_name || '플레이어';
    const separator = riotId.lastIndexOf('#');
    const gameName = separator > 0 ? riotId.slice(0, separator) : riotId;

    document.querySelector('#topbar-player-name').textContent = riotId;
    document.querySelector('#profile-name').textContent = gameName;
    document.querySelector('#profile-riot-id').textContent = riotId;
    document.querySelector('#avatar-initial').textContent = Array.from(gameName)[0] || '?';
    document.querySelector('#profile-level').textContent = player.player_level;
    document.querySelector('#info-player-name').textContent = riotId;
    document.querySelector('#info-player-id').textContent = player.player_id;
    document.querySelector('#info-player-level').textContent = player.player_level;
}

// 플레이어의 검색 후보 목록을 버튼으로 표시합니다.
function renderSearchCandidates(players) {
    searchResults.replaceChildren();
    const heading = createTextElement('p', 'candidate-heading', '검색 결과를 선택하세요.');
    searchResults.append(heading);

    for (const player of players) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'candidate-button';
        button.append(
            createTextElement('span', 'candidate-name', player.player_name),
            createTextElement('span', 'candidate-level', `Lv. ${player.player_level}`)
        );
        button.addEventListener('click', () => openProfile(player.player_id));
        searchResults.append(button);
    }
}

// Riot ID 또는 저장된 플레이어 이름으로 검색하고 일치 결과를 처리합니다.
async function searchPlayers(query) {
    searchButton.disabled = true;
    searchButton.querySelector('span').textContent = '검색 중';
    searchResults.replaceChildren();
    showSearchFeedback('플레이어를 찾고 있습니다.');

    try {
        const data = await requestJson(
            `/api/players/search?q=${encodeURIComponent(query)}`
        );
        const players = Array.isArray(data.players) ? data.players : [];

        if (data.player) {
            await openProfile(data.player.player_id);
        } else if (players.length === 1) {
            await openProfile(players[0].player_id);
        } else if (players.length > 1) {
            showSearchFeedback(`${players.length}명의 플레이어를 찾았습니다.`);
            renderSearchCandidates(players);
        } else {
            showSearchFeedback('검색 결과가 없습니다. Riot ID 전체를 입력해 다시 검색해 주세요.', true);
        }
    } catch (error) {
        showSearchFeedback(error.message, true);
    } finally {
        searchButton.disabled = false;
        searchButton.querySelector('span').textContent = '전적 검색';
    }
}

// 지정한 플레이어의 프로필과 최근 기록, 통계 화면을 불러옵니다.
async function openProfile(playerId, updateHistory = true) {
    const normalizedPlayerId = Number(playerId);
    if (!Number.isInteger(normalizedPlayerId) || normalizedPlayerId <= 0) {
        return;
    }

    const requestId = ++profileRequestId;
    activePlayerId = normalizedPlayerId;
    showScreen('profile');
    renderPlayerInfo({
        player_id: normalizedPlayerId,
        player_name: '플레이어 정보를 불러오는 중',
        player_level: '-',
    });
    resetProfilePanels();

    if (updateHistory) {
        window.history.pushState(
            { playerId: normalizedPlayerId },
            '',
            `/?playerId=${encodeURIComponent(normalizedPlayerId)}`
        );
    }

    const results = await Promise.allSettled([
        requestJson(`/api/players/${normalizedPlayerId}`),
        requestJson(`/api/players/${normalizedPlayerId}/characters`),
    ]);

    if (requestId !== profileRequestId) {
        return;
    }

    const [playerResult, characterResult] = results;
    if (playerResult.status === 'rejected') {
        showScreen('search');
        showSearchFeedback(playerResult.reason.message, true);
        window.history.replaceState({}, '', '/');
        return;
    }

    const player = playerResult.value.player;
    renderPlayerInfo(player);

    if (characterResult.status === 'fulfilled') {
        renderCharacterStats(characterResult.value.characters);
    } else {
        document.querySelector('#characters-message').textContent = characterResult.reason.message;
    }

    loadRecentMatches(10, requestId);
    loadStats(10, requestId);
}

// 플레이어가 바뀔 때까지 화면에 표시할 기본 상태를 설정합니다.
function resetProfilePanels() {
    document.querySelector('#matches-message').textContent = '최근 게임을 불러오는 중입니다.';
    document.querySelector('#matches-message').hidden = false;
    document.querySelector('#match-list').replaceChildren();
    document.querySelector('#characters-message').textContent = '캐릭터 통계를 불러오는 중입니다.';
    document.querySelector('#characters-message').hidden = false;
    document.querySelector('#characters-message').classList.remove('is-error');
    document.querySelector('#character-list').replaceChildren();
    document.querySelector('#stats-summary').textContent = '최근 10게임 통계를 불러오는 중입니다.';
    document.querySelector('#stats-summary').hidden = false;
    document.querySelector('#stats-summary').classList.remove('is-warning', 'is-error');
    document.querySelector('#stats-content').hidden = true;
    loadMoreStatsButton.hidden = true;
    loadMoreStatsButton.disabled = true;
}

// 저장된 최근 게임 목록을 결과와 KDA가 포함된 카드로 렌더링합니다.
function renderRecentMatches(matches) {
    const message = document.querySelector('#matches-message');
    const list = document.querySelector('#match-list');
    list.replaceChildren();

    if (!matches.length) {
        message.textContent = '저장된 게임 기록이 없습니다.';
        return;
    }

    message.hidden = true;
    for (const match of matches) {
        const isWin = match.result === 'WIN';
        const row = document.createElement('article');
        row.className = `match-row ${isWin ? 'is-win' : 'is-loss'}`;

        const result = createTextElement(
            'span',
            'match-result',
            isWin ? '승리' : '패배'
        );
        const details = document.createElement('div');
        details.className = 'match-main';
        details.append(
            createTextElement('strong', 'match-character', match.character_name),
            createTextElement(
                'span',
                'match-meta',
                `${formatMatchDate(match.match_date)} · ${formatDuration(match.game_duration)} · ${match.game_mode}`
            )
        );
        const kda = document.createElement('div');
        kda.className = 'match-kda';
        kda.append(
            createTextElement('strong', '', `${match.kills}/${match.deaths}/${match.assists}`),
            createTextElement('span', '', 'K / D / A')
        );
        const detailButton = createTextElement('button', 'match-detail-button', '상세 보기');
        detailButton.type = 'button';
        detailButton.addEventListener('click', () => showMatchDetails(match.match_id));

        row.append(result, details, kda, detailButton);
        list.append(row);
    }
}

// 요청된 누적 게임 수에 맞춰 최근 게임 목록을 다시 가져옵니다.
async function loadRecentMatches(count, requestId = profileRequestId) {
    const recentRequestId = ++recentMatchesRequestId;
    const message = document.querySelector('#matches-message');
    message.hidden = false;
    message.textContent = `최근 ${count}게임을 불러오는 중입니다.`;

    try {
        const data = await requestJson(
            `/api/players/${encodeURIComponent(activePlayerId)}/recent?count=${count}`
        );
        if (requestId !== profileRequestId || recentRequestId !== recentMatchesRequestId) {
            return;
        }
        renderRecentMatches(data.matches);
    } catch (error) {
        if (requestId !== profileRequestId || recentRequestId !== recentMatchesRequestId) {
            return;
        }
        message.hidden = false;
        message.textContent = error.message;
    }
}

// 캐릭터별 게임 수와 승률을 막대 그래프 목록으로 표시합니다.
function renderCharacterStats(characters) {
    const message = document.querySelector('#characters-message');
    const list = document.querySelector('#character-list');
    list.replaceChildren();
    message.classList.remove('is-error');

    if (!characters.length) {
        message.textContent = '저장된 캐릭터별 게임 기록이 없습니다.';
        return;
    }

    message.hidden = true;
    for (const character of characters) {
        const item = document.createElement('article');
        item.className = 'character-item';

        const heading = document.createElement('div');
        heading.className = 'character-heading';
        heading.append(
            createTextElement('strong', 'character-name', character.character_name),
            createTextElement('span', 'character-count', `${character.match_count}게임`)
        );

        const stats = document.createElement('div');
        stats.className = 'character-stats';
        stats.append(
            createTextElement('span', 'win-text', `${character.wins}승`),
            createTextElement('span', 'loss-text', `${character.losses}패`),
            createTextElement('strong', 'character-win-rate', `${formatPercent(character.win_rate)}%`)
        );

        const track = document.createElement('div');
        track.className = 'character-track';
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', `${character.character_name} 승률`);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(character.win_rate));
        const fill = document.createElement('span');
        fill.style.width = `${Math.max(0, Math.min(100, Number(character.win_rate) || 0))}%`;
        track.append(fill);

        item.append(heading, stats, track);
        list.append(item);
    }
}

// 새로 저장된 게임을 반영하도록 플레이어의 캐릭터 통계를 다시 가져옵니다.
async function loadCharacterStats(requestId = profileRequestId) {
    const currentRequestId = ++characterStatsRequestId;
    const message = document.querySelector('#characters-message');
    message.hidden = false;
    message.classList.remove('is-error');
    message.textContent = '캐릭터 통계를 업데이트 중입니다.';

    try {
        const data = await requestJson(
            `/api/players/${encodeURIComponent(activePlayerId)}/characters`
        );
        if (requestId !== profileRequestId || currentRequestId !== characterStatsRequestId) {
            return;
        }
        renderCharacterStats(data.characters);
    } catch (error) {
        if (requestId !== profileRequestId || currentRequestId !== characterStatsRequestId) {
            return;
        }
        message.hidden = false;
        message.classList.add('is-error');
        message.textContent = error.message;
    }
}

// 누적 게임 통계를 표시하고 서버가 제공한 다음 조회 범위를 설정합니다.
function renderStats(data, requestedCount) {
    const summary = document.querySelector('#stats-summary');
    const content = document.querySelector('#stats-content');
    const stats = data.stats;
    const winRate = Number(stats.win_rate) || 0;

    summary.hidden = true;
    summary.classList.remove('is-warning', 'is-error');
    content.hidden = false;
    document.querySelector('#stats-win-rate').textContent = `${formatPercent(winRate)}%`;
    document.querySelector('#stats-match-count').textContent = `${stats.match_count}게임`;
    document.querySelector('#stats-wins').textContent = stats.wins;
    document.querySelector('#stats-losses').textContent = stats.losses;
    document.querySelector('#stats-win-bar').style.width = `${Math.max(0, Math.min(100, winRate))}%`;

    const oldestDate = data.data_window?.oldest_match_date;
    document.querySelector('#stats-window-note').textContent = oldestDate
        ? `${data.data_window.fetched_matches}게임 기준 · 가장 오래된 게임 ${formatMatchDate(oldestDate)}`
        : `${data.data_window?.fetched_matches || 0}게임 기준`;

    if (data.warning) {
        summary.hidden = false;
        summary.textContent = data.warning;
        summary.classList.add('is-warning');
    } else {
        summary.classList.remove('is-warning');
    }

    const nextCount = data.data_window?.next_count;
    loadMoreStatsButton.hidden = !nextCount;
    loadMoreStatsButton.disabled = !nextCount;
    if (nextCount) {
        loadMoreStatsButton.dataset.nextCount = nextCount;
        loadMoreStatsButton.textContent = nextCount === requestedCount
            ? '현재 범위 다시 요청'
            : `${nextCount}게임까지 더 불러오기`;
    } else {
        delete loadMoreStatsButton.dataset.nextCount;
        loadMoreStatsButton.textContent = '10게임 더 불러오기';
    }
}

// 서버에서 지정한 누적 게임 수를 불러오고 오류 시 다시 시도할 수 있게 합니다.
async function loadStats(count, requestId = profileRequestId) {
    const summary = document.querySelector('#stats-summary');
    loadMoreStatsButton.disabled = true;
    loadMoreStatsButton.textContent = '불러오는 중…';
    summary.hidden = false;
    summary.classList.remove('is-warning', 'is-error');
    summary.textContent = `${count}게임 통계를 불러오는 중입니다.`;

    try {
        const data = await requestJson(
            `/api/players/${encodeURIComponent(activePlayerId)}/stats?count=${count}`
        );
        if (requestId !== profileRequestId) {
            return;
        }
        renderStats(data, count);
        await Promise.all([
            loadRecentMatches(count, requestId),
            loadCharacterStats(requestId),
        ]);
    } catch (error) {
        if (requestId !== profileRequestId) {
            return;
        }
        summary.hidden = false;
        summary.classList.add('is-error');
        summary.textContent = error.status === 429
            ? 'Riot API 요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.'
            : error.message;
        loadMoreStatsButton.hidden = false;
        loadMoreStatsButton.disabled = false;
        loadMoreStatsButton.dataset.nextCount = count;
        loadMoreStatsButton.textContent = '다시 시도';
    }
}

// 게임 타임스탬프와 진행 시간을 화면에 읽기 쉬운 형식으로 변환합니다.
function formatMatchDate(value) {
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) {
        return String(value || '');
    }
    return new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

// 승률 숫자를 불필요한 소수점 없이 표시합니다.
function formatPercent(value) {
    return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

// 초 단위 게임 시간을 분과 초로 변환합니다.
function formatDuration(value) {
    const seconds = Number(value) || 0;
    return `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
}

// 게임 상세 API 응답의 게임 정보와 참가자 목록을 다이얼로그에 표시합니다.
async function showMatchDetails(matchId) {
    matchDialog.showModal();
    document.querySelector('#match-dialog-title').textContent = '게임 상세';
    document.querySelector('#match-dialog-meta').textContent = '';
    document.querySelector('#match-dialog-message').textContent = '참가자 정보를 불러오는 중입니다.';
    document.querySelector('#participant-list').replaceChildren();

    try {
        const data = await requestJson(`/api/matches/${encodeURIComponent(matchId)}`);
        const match = data.match;
        document.querySelector('#match-dialog-title').textContent = match.match_id;
        document.querySelector('#match-dialog-meta').textContent =
            `${formatMatchDate(match.match_date)} · ${formatDuration(match.game_duration)} · ${match.game_mode}`;
        document.querySelector('#match-dialog-message').textContent = '';
        renderParticipants(data.participants);
    } catch (error) {
        document.querySelector('#match-dialog-message').textContent = error.message;
    }
}

// 양 팀 참가자의 챔피언, KDA, 게임 결과를 목록으로 렌더링합니다.
function renderParticipants(participants) {
    const list = document.querySelector('#participant-list');
    list.replaceChildren();

    for (const participant of participants) {
        const row = document.createElement('div');
        row.className = `participant-row ${participant.result === 'WIN' ? 'is-win' : 'is-loss'}`;
        row.append(
            createTextElement('span', 'participant-side', participant.team_side),
            createTextElement('strong', 'participant-player', participant.player_name),
            createTextElement('span', 'participant-character', participant.character_name),
            createTextElement(
                'span',
                'participant-kda',
                `${participant.kills}/${participant.deaths}/${participant.assists}`
            ),
            createTextElement(
                'span',
                `participant-result ${participant.result === 'WIN' ? 'win-text' : 'loss-text'}`,
                participant.result === 'WIN' ? '승리' : '패배'
            )
        );
        list.append(row);
    }
}

// 브라우저 뒤로 가기와 앞으로 가기에 맞춰 선택된 플레이어 화면을 복원합니다.
window.addEventListener('popstate', () => {
    const playerId = new URLSearchParams(window.location.search).get('playerId');
    if (playerId) {
        openProfile(playerId, false);
    } else {
        returnToSearch(false);
    }
});

// 검색 폼 제출 시 플레이어 검색 API를 호출합니다.
searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (query) {
        searchPlayers(query);
    }
});

// 다음 누적 조회 범위를 서버 응답에서 읽어 FR-07 통계를 더 불러옵니다.
loadMoreStatsButton.addEventListener('click', () => {
    const nextCount = Number(loadMoreStatsButton.dataset.nextCount);
    if (Number.isInteger(nextCount) && activePlayerId !== null) {
        loadStats(nextCount);
    }
});

// 새 플레이어 검색 버튼을 누르면 검색 화면으로 돌아갑니다.
document.querySelector('#new-search-button').addEventListener('click', () => {
    returnToSearch();
});

// 게임 상세 다이얼로그의 닫기 버튼으로 상세 화면을 닫습니다.
document.querySelector('#close-match-dialog').addEventListener('click', () => {
    matchDialog.close();
});

// 현재 URL에 플레이어 ID가 있으면 해당 플레이어 프로필을 복원합니다.
const initialPlayerId = new URLSearchParams(window.location.search).get('playerId');
if (initialPlayerId) {
    openProfile(initialPlayerId, false);
}
