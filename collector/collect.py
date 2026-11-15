#!/usr/bin/env python3
"""탑툰챗 4개국 공개 View·Chat 카운터 수집기.

사용법:
    python collector/collect.py            # 오늘(한국 날짜) 아침 수집이 없을 때만 수집
    python collector/collect.py --force    # 무조건 다시 수집해 오늘 값을 교체
    python collector/collect.py --market kr

표준 라이브러리만 사용합니다.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "site" / "data"

MARKETS = {
    "kr": "https://chat.toptoon.com",
    "tw": "https://chat.toptoon.net",
    "us": "https://chat.global.toptoon.com",
    "jp": "https://chat.toptoon.jp",
}

# 이 시각(KST) 이후에 수집된 기록이 있으면 그날은 다시 수집하지 않습니다.
MORNING_HOUR = 7
WORKERS = 6
TIMEOUT = 25
RETRIES = 3
# 직전 수집 대비 이 비율 미만으로 성공하면 저장하지 않습니다(사이트 장애 대비).
MIN_SUCCESS_RATIO = 0.6

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)

LINK_RE = re.compile(r"detail/(character|content)/(\d+)")
VIEW_RE = re.compile(r'\\?"viewCount\\?":\s*(\d+)')
CHAT_RE = re.compile(r'\\?"chatCount\\?":\s*(\d+)')
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
# 제목 "이름 AI 채팅 | ..." 에서 이름만 남깁니다(국가별 표기 포함).
TITLE_TAIL_RE = re.compile(r"\s*AI\s?(채팅|聊天|Chat|チャット).*$", re.S)


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch(url: str) -> str:
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko,en;q=0.8"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                return res.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def parse_detail(page: str) -> tuple[str, int, int] | None:
    """상세 페이지 HTML에서 (이름, View, Chat)을 뽑습니다. 못 찾으면 None."""
    v = VIEW_RE.search(page)
    c = CHAT_RE.search(page)
    if not v or not c:
        return None
    name = ""
    t = TITLE_RE.search(page)
    if t:
        name = TITLE_TAIL_RE.sub("", html.unescape(t.group(1))).strip()
    return name, int(v.group(1)), int(c.group(1))


def discover(base: str) -> set[str]:
    keys: set[str] = set()
    for path in ("/sitemap.xml", "/", "/explore"):
        try:
            for kind, item_id in LINK_RE.findall(fetch(base + path)):
                keys.add(f"{kind}:{item_id}")
        except RuntimeError as exc:
            log(f"  목록 페이지 실패 {path}: {exc}")
    return keys


def load(market: str) -> dict:
    path = DATA_DIR / f"{market}.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    return {"market": market, "source": MARKETS[market], "days": []}


def save(market: str, data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data["days"].sort(key=lambda d: d["date"])
    data["updated_at"] = datetime.now(KST).isoformat(timespec="seconds")
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (DATA_DIR / f"{market}.json").write_text(text, "utf-8")


def already_done(data: dict, today: str) -> bool:
    for day in data["days"]:
        if day["date"] == today and not day.get("imported"):
            captured = datetime.fromisoformat(day["captured_at"])
            if captured.astimezone(KST).hour >= MORNING_HOUR:
                return True
    return False


def collect_market(market: str, force: bool) -> bool:
    base = MARKETS[market]
    data = load(market)
    now = datetime.now(KST)
    today = now.strftime("%Y-%m-%d")
    if not force and already_done(data, today):
        log(f"[{market}] 오늘 아침 수집이 이미 있어 건너뜁니다.")
        return True

    keys = discover(base)
    prev = data["days"][-1]["items"] if data["days"] else {}
    keys |= set(prev)  # 목록에서 빠진 작품도 계속 추적
    log(f"[{market}] 대상 {len(keys)}개 수집 시작")

    def work(key: str):
        kind, item_id = key.split(":")
        try:
            return key, parse_detail(fetch(f"{base}/detail/{kind}/{item_id}"))
        except RuntimeError:
            return key, None

    items: dict[str, list] = {}
    with ThreadPoolExecutor(WORKERS) as pool:
        for key, parsed in pool.map(work, sorted(keys)):
            if parsed:
                name, view, chat = parsed
                if not name and key in prev:
                    name = prev[key][0]
                items[key] = [name, view, chat]

    expected = max(10, int(len([k for k in prev]) * MIN_SUCCESS_RATIO))
    if len(items) < expected:
        log(f"[{market}] 성공 {len(items)}개로 너무 적어 저장하지 않습니다(기준 {expected}개).")
        return False

    data["days"] = [d for d in data["days"] if d["date"] != today]
    data["days"].append({
        "date": today,
        "captured_at": now.isoformat(timespec="seconds"),
        "items": items,
    })
    save(market, data)
    log(f"[{market}] 저장 완료: {len(items)}개 (View {sum(v[1] for v in items.values()):,}, "
        f"Chat {sum(v[2] for v in items.values()):,})")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="오늘 수집이 있어도 다시 수집")
    ap.add_argument("--market", choices=sorted(MARKETS), help="한 나라만 수집")
    args = ap.parse_args()
    markets = [args.market] if args.market else list(MARKETS)
    ok = True
    for m in markets:
        try:
            ok = collect_market(m, args.force) and ok
        except Exception as exc:  # 한 나라가 실패해도 나머지는 진행
            log(f"[{m}] 오류: {exc}")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
