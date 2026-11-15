# 탑툰챗 트래커

탑툰챗 한국·대만·미국·일본 사이트의 공개 페이지에 표시되는 작품별 **View·Chat 누적 카운터**를 매일 아침 기록하고, 대시보드로 보여 줍니다.

- 매일 **07:05 KST**에 GitHub Actions가 자동으로 수집합니다. 지연되거나 실패할 때를 대비해 07:35와 09:05에 다시 시도하며, 이미 수집했으면 건너뜁니다.
- 내 PC를 켜 둘 필요가 없고, 로그인도 필요 없습니다.
- 대시보드 주소: `https://<내 GitHub 아이디>.github.io/<저장소 이름>/`

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `collector/collect.py` | 수집기 (표준 라이브러리만 사용) |
| `collector/import_history.py` | (선택) 다른 공개 트래커의 과거 기록을 한 번 가져오기 |
| `site/` | 대시보드 (`index.html`, `app.js`, `style.css`) |
| `site/data/kr.json` 등 | 국가별 일별 기록 (자동 생성) |
| `.github/workflows/collect.yml` | 매일 수집하고 사이트를 배포하는 자동 실행 설정 |

## 처음 설정하기 (약 10분)

1. **저장소 만들기**: GitHub에서 **New repository**를 눌러 새 저장소를 만듭니다. 이름은 자유롭게 정하세요(예: `tt-tracker`).
   - 무료 계정이라면 **Public**으로 만들어야 GitHub Pages를 쓸 수 있습니다. 공개 저장소여도 다른 사람에게 알림이 가지는 않으며, 대시보드에는 검색엔진 수집을 막는 설정이 들어 있습니다.
2. **파일 올리기**: 저장소 화면에서 **Add file → Upload files**를 누르고, 압축을 푼 폴더 안의 `collector`, `site` 폴더와 `README.md`를 끌어다 놓은 뒤 **Commit changes**를 누릅니다.
3. **자동 실행 파일 만들기**: 맥이나 윈도우는 `.github` 폴더를 숨김 폴더로 처리해서 2번에서 빠지기 쉽습니다. **Add file → Create new file**을 누르고 파일 이름 칸에 `.github/workflows/collect.yml`을 입력합니다. 압축 파일 안의 같은 파일 내용을 그대로 붙여넣은 뒤 **Commit changes**를 누릅니다.
4. **Pages 켜기**: **Settings → Pages**에서 **Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
5. **첫 수집 실행**: **Actions** 탭에서 **수집 및 배포**를 고르고 **Run workflow**를 누릅니다.
   - 과거 그래프를 바로 보고 싶다면 `import_from` 칸에 과거 기록이 있는 공개 페이지 주소를 넣습니다. 비워 두면 오늘부터 쌓입니다.
6. 2~3분 뒤 실행이 초록색으로 끝나면 대시보드 주소로 들어가 확인합니다.

## 지금 바로 다시 수집하기

**Actions → 수집 및 배포 → Run workflow**를 누릅니다. 오늘 아침 값을 새로 받고 싶으면 **force**를 체크합니다.

## 커스터마이징 포인트

| 바꾸고 싶은 것 | 위치 |
|---|---|
| 수집 시각 | `.github/workflows/collect.yml`의 `cron` 값 (UTC 기준이라 한국시간에서 9시간을 뺍니다) |
| 하루 기준 시각 (중복 수집 방지) | `collector/collect.py`의 `MORNING_HOUR` |
| 대상 국가·사이트 | `collector/collect.py`의 `MARKETS`, `site/app.js`의 `MARKETS` |
| 차트 색·배경 | `site/style.css` 맨 위의 `--s1`~`--s4` 등 |
| 탭·카드·차트 구성 | `site/index.html`, `site/app.js`의 `render…` 함수들 |

## 수집 방식과 해석

- **집계 기준(원본 사이트와 동일)**: 그날 홈(`/`)·탐색(`/explore`)·랭킹(`/ranking`) 페이지에 링크로 걸린 작품만 합계에 넣습니다. 그래서 그날 노출된 작품이 바뀌면 합계도 함께 출렁일 수 있습니다. 각 작품의 숫자는 상세 페이지 HTML에 들어 있는 `viewCount`·`chatCount`를 읽습니다.
- 원자료는 넓게 남깁니다: 사이트맵에 있는 전체 작품도 함께 수집해 `items`에 저장하고, 그날 집계에 들어간 작품 목록은 `listed`에 따로 저장합니다.
- 수집이 하루 빠지면 다음 수집이 이틀 치 증가를 한 번에 보여 줍니다.
- 집계 대상 작품 중 60% 미만만 읽혔거나 홈·탐색·랭킹 페이지를 못 읽으면 사이트 장애로 보고 저장하지 않습니다.
- 공개 카운터는 매출이나 실제 이용자 수와 다릅니다.
- GitHub Actions 예약은 정시를 보장하지 않아 1~2시간 늦게 실행될 수 있습니다. 공개 저장소에 60일 동안 활동이 없으면 예약이 꺼질 수 있지만, 매일 데이터가 저장되므로 보통은 문제가 없습니다.

## 내 PC에서 실행해 보기

```bash
python collector/collect.py --force       # site/data/*.json 생성
cd site && python -m http.server 8000     # http://localhost:8000 접속
```
