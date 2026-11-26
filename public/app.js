const statusElement = document.querySelector('#status');
const responseElement = document.querySelector('#response');
const matchIdInput = document.querySelector('#match-id');
const statsSubmitButton = document.querySelector('#stats-form button[type="submit"]');
const loadMoreStatsButton = document.querySelector('#load-more-stats');

let currentStatsCount = 0;

// API 요청의 상태와 HTTP 응답 코드를 화면에 표시합니다.
function setStatus(method, url, status) {
    statusElement.textContent = `${method} ${url} — HTTP ${status}`;
}

// API를 호출하고 응답 본문을 형식화하여 결과 영역에 출력합니다.
async function request(method, url, body) {
    const options = {
        method,
        headers: {},
    };

    if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    setStatus(method, url, response.status);
    responseElement.textContent = typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2);

    return { response, data };
}

// Riot ID 기준으로 경기를 수집하고 첫 매치 ID를 상세 조회 입력란에 채웁니다.
async function collect(riotId, count) {
    const result = await request('POST', '/api/matches/collect', { riotId, count });

    if (result.response.ok) {
        const firstMatch = result.data.matches?.[0];
        if (firstMatch?.match_id) {
            matchIdInput.value = firstMatch.match_id;
        }
    }

    return result;
}

// 경기 수집 폼을 제출하면 입력한 Riot ID와 건수로 수집 API를 호출합니다.
document.querySelector('#collect-form').addEventListener('submit', (event) => {
    event.preventDefault();
    collect(
        document.querySelector('#riot-id').value,
        Number(document.querySelector('#collect-count').value)
    );
});

// 매치 ID 입력값을 검증한 뒤 경기 상세 API를 호출합니다.
document.querySelector('#detail-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const matchId = matchIdInput.value.trim();
    if (!matchId) {
        setStatus('GET', '/api/matches/:matchId', '-');
        responseElement.textContent = '상세 조회할 Match ID를 입력하세요.';
        return;
    }
    request('GET', `/api/matches/${encodeURIComponent(matchId)}`);
});

// 통계 폼 제출 시 누적 건수를 초기화하고 최근 10경기 통계를 요청합니다.
document.querySelector('#stats-form').addEventListener('submit', (event) => {
    event.preventDefault();
    currentStatsCount = 0;
    loadStats(10);
});

// 서버가 알려준 다음 조회 건수가 있으면 추가 통계 조회를 시작합니다.
loadMoreStatsButton.addEventListener('click', () => {
    const nextCount = Number(loadMoreStatsButton.dataset.nextCount);
    if (Number.isInteger(nextCount) && nextCount >= currentStatsCount) {
        loadStats(nextCount);
    }
});

// 지정한 누적 경기 수의 통계를 요청하고 추가 조회 버튼 상태를 갱신합니다.
async function loadStats(count) {
    const playerId = document.querySelector('#stats-player-id').value;
    const previousCount = currentStatsCount;
    statsSubmitButton.disabled = true;
    loadMoreStatsButton.disabled = true;

    try {
        const result = await request(
            'GET',
            `/api/players/${encodeURIComponent(playerId)}/stats?count=${count}`
        );

        if (!result.response.ok) {
            restoreLoadMoreButton(previousCount);
            return;
        }

        currentStatsCount = count;
        const nextCount = result.data.data_window?.next_count;
        if (nextCount) {
            loadMoreStatsButton.dataset.nextCount = nextCount;
            loadMoreStatsButton.textContent = nextCount === count
                ? '현재 범위 다시 요청'
                : '10경기 더 불러오기';
            loadMoreStatsButton.disabled = false;
        } else {
            delete loadMoreStatsButton.dataset.nextCount;
            loadMoreStatsButton.textContent = '10경기 더 불러오기';
        }
    } catch (error) {
        setStatus('GET', `/api/players/${playerId}/stats`, '네트워크 오류');
        responseElement.textContent = error.message;
        restoreLoadMoreButton(previousCount);
    } finally {
        statsSubmitButton.disabled = false;
    }
}

// 조회 실패 후 현재 누적 범위를 다시 요청할 수 있도록 버튼을 복구합니다.
function restoreLoadMoreButton(count) {
    if (count > 0 && count < 100) {
        loadMoreStatsButton.dataset.nextCount = count + 10;
        loadMoreStatsButton.textContent = '10경기 더 불러오기';
        loadMoreStatsButton.disabled = false;
    }
}

// 결과 영역과 요청 상태를 초기 상태로 되돌립니다.
document.querySelector('#clear-result').addEventListener('click', () => {
    statusElement.textContent = '실행 대기';
    responseElement.textContent = '결과가 여기에 표시됩니다.';
});

// 테스트 전용 버튼마다 해당하는 API 테스트 동작을 연결합니다.
document.querySelectorAll('[data-test]').forEach((button) => {
    // 선택한 테스트 종류에 맞는 API 요청을 실행합니다.
    button.addEventListener('click', () => {
        const testName = button.dataset.test;

        if (testName === 'health') {
            request('GET', '/health');
        } else if (testName === 'collect-invalid') {
            collect('잘못된입력', 3);
        } else if (testName === 'collect-limit') {
            collect(document.querySelector('#riot-id').value, 999);
        } else if (testName === 'collect-repeat') {
            collect(document.querySelector('#riot-id').value, 3);
        } else if (testName === 'detail-missing') {
            request('GET', '/api/matches/KR_NOT_EXIST');
        }
    });
});
