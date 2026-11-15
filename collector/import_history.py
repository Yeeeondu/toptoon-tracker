#!/usr/bin/env python3
"""(선택) 공개된 다른 트래커 페이지의 과거 기록을 한 번만 가져옵니다.

처음 만들었을 때 그래프가 비어 있지 않도록 지난 날짜의 작품별 View·Chat을 채웁니다.
이미 내 데이터에 있는 날짜는 건드리지 않습니다. GitHub Actions의
"과거 기록 가져오기" 워크플로에서 한 번 실행하면 됩니다.

    python collector/import_history.py --base https://example.github.io/somepath
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import MARKETS, fetch, load, log, save  # noqa: E402

FILES = {"kr": "snapshots.json", "tw": "snapshots-tw.json", "us": "snapshots-us.json", "jp": "snapshots-jp.json"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="data/ 폴더가 있는 공개 페이지 주소")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    for market in MARKETS:
        try:
            src = json.loads(fetch(f"{base}/data/{FILES[market]}"))
        except Exception as exc:
            log(f"[{market}] 가져오기 실패: {exc}")
            continue
        by_date: dict[str, dict] = {}
        for snap in sorted(src.get("snapshots", []), key=lambda s: s.get("captured_at", "")):
            items = {
                it["key"]: [it.get("name", ""), int(it["view_count"]), int(it["chat_count"])]
                for it in snap.get("items", [])
                if it.get("view_count") is not None and it.get("chat_count") is not None
            }
            if not items:
                continue
            date = snap.get("captured_kst", snap["captured_at"])[:10]
            by_date[date] = {"date": date, "captured_at": snap["captured_at"], "items": items, "imported": True}

        data = load(market)
        own = {d["date"] for d in data["days"]}
        added = [d for date, d in by_date.items() if date not in own]
        data["days"].extend(added)
        save(market, data)
        log(f"[{market}] 과거 {len(added)}일 추가 (총 {len(data['days'])}일)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
