const statusElement = document.querySelector('#status');
const responseElement = document.querySelector('#response');
const matchIdInput = document.querySelector('#match-id');

function setStatus(method, url, status) {
    statusElement.textContent = `${method} ${url} — HTTP ${status}`;
}

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

document.querySelector('#collect-form').addEventListener('submit', (event) => {
    event.preventDefault();
    collect(
        document.querySelector('#riot-id').value,
        Number(document.querySelector('#collect-count').value)
    );
});

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

document.querySelector('#clear-result').addEventListener('click', () => {
    statusElement.textContent = '실행 대기';
    responseElement.textContent = '결과가 여기에 표시됩니다.';
});

document.querySelectorAll('[data-test]').forEach((button) => {
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
