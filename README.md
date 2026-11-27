# LeagueGG — 게임 전적 조회 및 통계 시스템

Riot API를 통해 플레이어 및 게임 데이터를 수집·저장하고, SQL 집계 쿼리를 바탕으로 전적·승률·캐릭터별 통계를 조회하는 웹 애플리케이션입니다.

---

* 프로젝트 제출 방식: GitHub 주소. 리포지토리에 프로젝트 전체 파일과 결과 보고서가 포함되어 있습니다.
* 프로젝트 구성: 확장형 A, 아래의 프로젝트 폴더 구조를 참고하세요.

---

## 주요 기능 (FR-01 ~ FR-08)

| ID | 기능 | 설명 |
| :--- | :--- | :--- |
| **FR-01** | 플레이어 검색 | 플레이어 식별 정보를 이용한 검색 |
| **FR-02** | 플레이어 정보 관리 | 플레이어 정보 저장 및 조회 |
| **FR-03** | 게임 기록 수집 | 플레이어의 게임 기록 확보 |
| **FR-04** | 게임 기록 저장 | 게임 및 참여 기록을 DB에 저장 |
| **FR-05** | 최근 전적 조회 | 플레이어별 최근 게임 기록 조회 |
| **FR-06** | 게임 상세 조회 | 게임 참여자 및 게임 기록 조회 |
| **FR-07** | 전적 통계 조회 | 게임 수, 승패 및 승률 조회 |
| **FR-08** | 캐릭터별 통계 조회 | 캐릭터별 게임 수 및 승률 조회 |

---

## 프로젝트 폴더 구조

```text
leaguegg/
├── package.json
├── .env                  # RIOT_API_KEY 환경 변수 (Git 추적 제외)
├── .gitignore
├── README.md
├── server.js             # Express 서버 진입점
├── db/
│   ├── database.js       # better-sqlite3 연결 및 테이블 초기화
│   └── leaguegg.db       # 로컬 SQLite DB 파일 (자동 생성, Git 추적 제외)
├── services/
|   └── matchStorage.js   # 공통 게임 저장 트랜잭션
│   └── riotApi.js        # Riot API 호출 및 응답 데이터 정규화
├── routes/
│   ├── players.js        # FR-01, FR-02, FR-05, FR-07, FR-08
│   └── matches.js        # FR-03, FR-04, FR-06
└── public/
    ├── index.html        # 플레이어 검색 및 전적 대시보드
    ├── app.js            # API 연동 및 화면 동작
    └── styles.css        # 반응형 화면 스타일
```

---

## 로컬 개발 환경 설정 및 실행

1. **패키지 설치**
```bash
npm install
```
2. **환경 변수(`.env`) 설정**
프로젝트 루트에 `.env` 파일을 생성하고 발급받은 Riot API 키를 입력합니다. (Development API Key는 24시간마다 만료되므로 주기적으로 갱신해야 합니다.)
```env
RIOT_API_KEY=RGAPI-여기에_API_키_입력
```
3. **서버 실행**
`package.json`의 `"scripts"`에 `"start": "node server.js"`를 설정한 뒤 아래 명령으로 실행합니다.
```bash
npm start
```
---

## 기존 모델링에서 변경된 점

* `GAME_MATCH` 테이블의 `match_id` 컬럼이 Riot API의 고유 게임 ID 형식에 맞춰 `TEXT PRIMARY KEY`로 정의가 변경되었습니다.
* API RATE LIMIT을 방지하기 위해, **FR-07 전적 통계**의 기능을 수행하는 `GET /api/players/:playerId/stats`은 Riot API에서 해당 플레이어의 최근 게임 최대 10개의 게임 ID를 가져와 DB에 없는 게임만 상세 정보를 가져와 저장한 다음, 이 조회 범위에 대한 게임 수·승·패·승률을 반환하는 방식으로 기능이 부분적으로 변경되었습니다. 그리고 이후, 앱 내 버튼을 통해 `GET /api/players/:playerId/stats?count=XX`를 실행하여 최대 50게임까지 10게임씩 조회를 늘릴 수 있도록 했습니다. 응답의 `data_window.oldest_match_timestamp`는 가장 오래된 게임 시작 시각의 Unix 밀리초이며, `data_window.oldest_match_date`에는 ISO 형식 시각이 포함됩니다.
