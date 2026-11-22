# LeagueGG — 게임 전적 조회 및 통계 시스템

Riot API를 통해 플레이어 및 경기 데이터를 수집·저장하고, SQL 집계 쿼리를 바탕으로 전적·승률·캐릭터별 통계를 조회하는 웹 애플리케이션입니다[cite: 1, 2, 3].

---

## 주요 기능 (FR-01 ~ FR-08)

| ID | 기능 | 설명 |
| :--- | :--- | :--- |
| **FR-01** | 플레이어 검색 | 플레이어 식별 정보를 이용한 검색[cite: 1] |
| **FR-02** | 플레이어 정보 관리 | 플레이어 정보 저장 및 조회[cite: 1] |
| **FR-03** | 경기 기록 수집 | 플레이어의 경기 기록 확보[cite: 1] |
| **FR-04** | 경기 기록 저장 | 경기 및 참여 기록을 DB에 저장[cite: 1] |
| **FR-05** | 최근 전적 조회 | 플레이어별 최근 경기 기록 조회[cite: 1] |
| **FR-06** | 경기 상세 조회 | 경기 참여자 및 경기 기록 조회[cite: 1] |
| **FR-07** | 전적 통계 조회 | 경기 수, 승패 및 승률 조회[cite: 1] |
| **FR-08** | 캐릭터별 통계 조회 | 캐릭터별 경기 수 및 승률 조회[cite: 1] |

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
│   └── riotApi.js        # Riot API 호출 및 응답 데이터 정규화
├── routes/
│   ├── players.js        # FR-01, FR-02, FR-05, FR-07, FR-08
│   └── matches.js        # FR-03, FR-04, FR-06
└── public/
    ├── index.html
    └── app.js
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

* `GAME_MATCH` 테이블의 `match_id` 컬럼이 Riot API의 고유 매치 ID 형식에 맞춰 `TEXT PRIMARY KEY`로 정의가 변경되었습니다.