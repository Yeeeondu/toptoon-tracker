"use strict";

// ───────── 설정 ─────────
const MARKETS = [
  { id: "kr", name: "한국", color: "--s1" },
  { id: "tw", name: "대만", color: "--s2" },
  { id: "us", name: "미국", color: "--s3" },
  { id: "jp", name: "일본", color: "--s4" },
];
const TABS = [{ id: "all", name: "종합" }, ...MARKETS];
const METRIC_LABEL = { view: "View", chat: "Chat" };
const REFRESH_MS = 10 * 60 * 1000;

const state = {
  market: new URLSearchParams(location.search).get("market") || "all",
  metric: "view",
  range: 30,
  search: "",
  sort: null, // {key, dir}
  data: {},   // marketId -> 가공된 데이터
};
if (!TABS.some(t => t.id === state.market)) state.market = "all";

// ───────── 유틸 ─────────
const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const nf = new Intl.NumberFormat("ko-KR");
const fmt = n => (n == null ? "—" : nf.format(Math.round(n)));
function short(n) {
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, "") + "억";
  if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "만";
  return nf.format(n);
}
const signed = n => (n == null ? "—" : (n > 0 ? "+" : "") + fmt(n));
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
function kstToday() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
function mondayOf(d) {
  const t = new Date(d + "T00:00:00Z");
  const wd = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - wd);
  return t.toISOString().slice(0, 10);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ───────── 데이터 ─────────
function prepare(raw) {
  const days = (raw.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const totals = new Map();
  const gains = new Map();
  days.forEach((day, i) => {
    let v = 0, c = 0;
    for (const it of Object.values(day.items)) { v += it[1]; c += it[2]; }
    totals.set(day.date, { view: v, chat: c });
    if (i > 0) {
      const prev = days[i - 1].items;
      let gv = 0, gc = 0;
      for (const [k, it] of Object.entries(day.items)) {
        const p = prev[k];
        if (!p) continue;
        gv += Math.max(0, it[1] - p[1]);
        gc += Math.max(0, it[2] - p[2]);
      }
      gains.set(day.date, { view: gv, chat: gc });
    }
  });
  return { source: raw.source, updated: raw.updated_at, days, totals, gains };
}

async function loadAll() {
  const bust = "?t=" + Math.floor(Date.now() / 60000);
  const results = await Promise.all(MARKETS.map(async m => {
    try {
      const r = await fetch(`data/${m.id}.json${bust}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return [m.id, prepare(await r.json())];
    } catch {
      return [m.id, state.data[m.id] || prepare({ days: [] })];
    }
  }));
  state.data = Object.fromEntries(results);
}

const activeMarkets = () => (state.market === "all" ? MARKETS : MARKETS.filter(m => m.id === state.market));

function allDates(kind) {
  const set = new Set();
  for (const m of activeMarkets()) for (const d of state.data[m.id][kind].keys()) set.add(d);
  return [...set].sort();
}

function clip(dates) {
  return state.range ? dates.slice(-state.range) : dates;
}

// 날짜 목록 + 국가별 값 → 차트용 시리즈
function seriesFor(kind, dates, metric) {
  return activeMarkets().map(m => ({
    name: m.name,
    color: css(m.color),
    values: dates.map(d => state.data[m.id][kind].get(d)?.[metric] ?? null),
  }));
}

function grouped(keyFn, metric) {
  const buckets = new Map();
  for (const m of activeMarkets()) {
    for (const [d, g] of state.data[m.id].gains) {
      const k = keyFn(d);
      if (!buckets.has(k)) buckets.set(k, {});
      const b = buckets.get(k);
      b[m.id] = (b[m.id] || 0) + g[metric];
    }
  }
  const keys = [...buckets.keys()].sort();
  return {
    keys,
    series: activeMarkets().map(m => ({ name: m.name, color: css(m.color), values: keys.map(k => buckets.get(k)[m.id] ?? null) })),
  };
}

// ───────── 차트 (의존성 없는 SVG) ─────────
function niceTicks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step;
  const ticks = [];
  for (let t = lo; t <= max + step * 0.001; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function emptyChart(el, legendEl, msg) {
  el.innerHTML = `<div class="empty">${msg}</div>`;
  legendEl.innerHTML = "";
}

function drawChart(el, legendEl, labels, series, { type = "bar", tipTitle = l => l, xLabel = l => l } = {}) {
  const has = series.some(s => s.values.some(v => v != null));
  if (!labels.length || !has) return emptyChart(el, legendEl, "기록이 2일 이상 쌓이면 표시됩니다");

  const W = el.clientWidth || 500, H = el.clientHeight || 230;
  const pad = { l: 46, r: 8, t: 8, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const stacked = series.length > 1;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));

  let lo = 0, hi;
  if (type === "line" && !stacked) {
    const vals = series[0].values.filter(v => v != null);
    lo = Math.min(...vals); hi = Math.max(...vals);
    const p = (hi - lo) * 0.1 || hi * 0.01 || 1;
    lo = Math.max(0, lo - p); hi += p;
  } else {
    hi = Math.max(...totals) || 1;
  }
  const ticks = niceTicks(lo, hi);
  lo = ticks[0]; hi = ticks[ticks.length - 1];
  const y = v => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const bw = iw / labels.length;
  const x = i => pad.l + bw * i + bw / 2;

  const surface = css("--surface");
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  svg += `<g class="axis">`;
  for (const t of ticks) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`;
  }
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(iw / 64))));
  labels.forEach((l, i) => {
    if (i % every === 0 || i === labels.length - 1 && labels.length < 4)
      svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(l))}</text>`;
  });
  svg += `</g>`;

  if (type === "line" && !stacked) {
    const s = series[0];
    const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
    let d = "", pen = false;
    pts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); pen = true; });
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts.map((p, i) => [p, i]).filter(([p]) => p).pop();
    if (last) svg += `<circle cx="${last[0][0]}" cy="${last[0][1]}" r="4" fill="${s.color}" stroke="${surface}" stroke-width="2"/>`;
  } else {
    const w = Math.max(2, Math.min(28, bw * 0.68));
    labels.forEach((_, i) => {
      let base = lo;
      const segs = series.map(s => ({ v: s.values[i] || 0, c: s.color })).filter(s => s.v > 0);
      segs.forEach((sg, j) => {
        const y0 = y(base), y1 = y(base + sg.v);
        base += sg.v;
        const top = j === segs.length - 1;
        const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
        const yy = y0 - (j > 0 ? 2 : 0) - h;
        const r = top ? Math.min(4, w / 2, h) : 0;
        const x0 = x(i) - w / 2;
        svg += `<path d="M${x0},${yy + h}V${yy + r}Q${x0},${yy} ${x0 + r},${yy}H${x0 + w - r}Q${x0 + w},${yy} ${x0 + w},${yy + r}V${yy + h}Z" fill="${sg.c}"/>`;
      });
    });
  }
  svg += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(lo)}" y2="${y(lo)}"/>`;

  // 마우스 오버 영역
  labels.forEach((_, i) => {
    svg += `<rect class="hit" data-i="${i}" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}"/>`;
    svg += `<rect class="hover-band" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}" fill="transparent" pointer-events="none"/>`;
  });
  svg += `</svg>`;
  el.innerHTML = svg;

  const tip = $("#tip");
  el.querySelectorAll(".hit").forEach(r => {
    r.addEventListener("mousemove", e => {
      const i = +r.dataset.i;
      let h = `<b>${esc(tipTitle(labels[i]))}</b>`;
      for (const s of series) h += `<div class="row"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><span>${fmt(s.values[i])}</span></div>`;
      if (stacked) h += `<div class="row"><span>합계</span><span>${fmt(totals[i])}</span></div>`;
      tip.innerHTML = h; tip.hidden = false;
      const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
      tip.style.left = tx + "px"; tip.style.top = (e.clientY + 14) + "px";
    });
    r.addEventListener("mouseleave", () => { tip.hidden = true; });
  });

  legendEl.innerHTML = series.length > 1
    ? series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")
    : "";
}

// ───────── 화면 그리기 ─────────
function renderTabs() {
  $("#tabs").innerHTML = TABS.map(t => `<a href="?market=${t.id}" data-id="${t.id}" class="${t.id === state.market ? "on" : ""}">${t.name}</a>`).join("");
  const tab = TABS.find(t => t.id === state.market);
  $("#title").textContent = state.market === "all" ? "탑툰챗 트래커 · 종합" : `탑툰챗 트래커 · ${tab.name}`;
  document.title = $("#title").textContent;
}

function latestOf(id) { const d = state.data[id].days; return d[d.length - 1]; }

function renderUpdated() {
  const stamps = activeMarkets().map(m => latestOf(m.id)).filter(Boolean);
  if (!stamps.length) { $("#updated").textContent = "아직 수집된 데이터가 없습니다"; return; }
  const last = stamps.map(s => s.captured_at).sort().pop();
  const t = new Date(last);
  const text = `마지막 수집 ${t.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  const kstHour = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const stale = stamps.some(s => s.date !== kstToday()) && kstHour >= 10;
  $("#updated").innerHTML = esc(text) + (stale ? ` · <span class="warn">오늘 수집이 아직 없어요</span>` : "");
}

function renderCards() {
  const ms = activeMarkets();
  let items = 0, chars = 0, conts = 0, gv = null, gc = null, pv = null, pc = null;
  let first = null, last = null, nDays = 0;
  for (const m of ms) {
    const d = state.data[m.id];
    const lt = d.days[d.days.length - 1];
    if (lt) {
      for (const k of Object.keys(lt.items)) { items++; k.startsWith("content") ? conts++ : chars++; }
      if (!first || d.days[0].date < first) first = d.days[0].date;
      if (!last || lt.date > last) last = lt.date;
    }
    const g = [...d.gains.entries()];
    if (g.length) {
      const [, cur] = g[g.length - 1];
      gv = (gv || 0) + cur.view; gc = (gc || 0) + cur.chat;
      if (g.length > 1) { const [, p] = g[g.length - 2]; pv = (pv || 0) + p.view; pc = (pc || 0) + p.chat; }
    }
  }
  if (first) nDays = Math.round((new Date(last) - new Date(first)) / 864e5) + 1;
  const diff = (c, p) => {
    if (c == null || p == null || !p) return "전날 대비";
    const r = ((c - p) / p) * 100;
    return `그 전날보다 ${r >= 0 ? "+" : ""}${r.toFixed(1)}%`;
  };
  const cards = [
    ["추적 작품", fmt(items), `캐릭터 ${fmt(chars)} · 작품 ${fmt(conts)}`],
    ["최근 View 순증", gv == null ? "—" : "+" + fmt(gv), diff(gv, pv)],
    ["최근 Chat 순증", gc == null ? "—" : "+" + fmt(gc), diff(gc, pc)],
    ["데이터 기간", nDays ? `${fmt(nDays)}일` : "—", first ? `${first} ~ ${last}` : "수집 전"],
  ];
  $("#cards").innerHTML = cards.map(([k, v, d]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${esc(d)}</div></div>`).join("");
}

function renderCharts() {
  const metric = state.metric, ml = METRIC_LABEL[metric];
  $("#h-daily").textContent = `일별 ${ml} 순증`;
  $("#h-abs").textContent = `일별 ${ml} 누적 합계`;
  $("#h-week").textContent = `주별 ${ml} 순증`;
  $("#h-month").textContent = `월별 ${ml} 순증`;
  $("#s-daily").textContent = state.range ? `최근 ${state.range}일 · 전날 수집 대비` : "전체 기간 · 전날 수집 대비";

  const gd = clip(allDates("gains"));
  drawChart($("#c-daily"), $("#l-daily"), gd, seriesFor("gains", gd, metric), { xLabel: md });

  const td = clip(allDates("totals"));
  drawChart($("#c-abs"), $("#l-abs"), td, seriesFor("totals", td, metric), { type: "line", xLabel: md });

  const w = grouped(mondayOf, metric);
  const wk = state.range ? w.keys.slice(-Math.ceil(state.range / 7) - 1) : w.keys;
  const wi = w.keys.length - wk.length;
  drawChart($("#c-week"), $("#l-week"), wk, w.series.map(s => ({ ...s, values: s.values.slice(wi) })), {
    xLabel: md, tipTitle: k => `${md(k)} 시작 주`,
  });

  const mo = grouped(d => d.slice(0, 7), metric);
  drawChart($("#c-month"), $("#l-month"), mo.keys, mo.series, {
    xLabel: k => `${+k.slice(5)}월`, tipTitle: k => `${k.slice(0, 4)}년 ${+k.slice(5)}월`,
  });
}

function tableRows() {
  const rows = [];
  for (const m of activeMarkets()) {
    const d = state.data[m.id];
    const n = d.days.length;
    if (!n) continue;
    const cur = d.days[n - 1].items, prev = n > 1 ? d.days[n - 2].items : {};
    for (const [key, [name, view, chat]] of Object.entries(cur)) {
      const [kind, id] = key.split(":");
      const p = prev[key];
      rows.push({
        market: m.name, kind: kind === "content" ? "작품" : "캐릭터", name: name || key,
        url: `${d.source}/detail/${kind}/${id}`, view, chat,
        dview: p ? view - p[1] : null, dchat: p ? chat - p[2] : null,
      });
    }
  }
  return rows;
}

const COLS = [
  { key: "rank", label: "순위", sortable: false },
  { key: "market", label: "국가", l: true, allOnly: true },
  { key: "kind", label: "구분", l: true },
  { key: "name", label: "작품", l: true },
  { key: "view", label: "View" },
  { key: "chat", label: "Chat" },
  { key: "dview", label: "View 증감" },
  { key: "dchat", label: "Chat 증감" },
];

function currentRows() {
  const sort = state.sort || { key: state.metric === "view" ? "dview" : "dchat", dir: -1 };
  const q = state.search.trim().toLowerCase();
  let rows = tableRows();
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));
  rows.sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * sort.dir;
  });
  return { rows, sort };
}

function renderTable() {
  const { rows, sort } = currentRows();
  const cols = COLS.filter(c => !c.allOnly || state.market === "all");
  $("#table thead").innerHTML = "<tr>" + cols.map(c => {
    const arrow = sort.key === c.key ? (sort.dir < 0 ? " ▼" : " ▲") : "";
    return `<th class="${c.l ? "l" : ""}" data-key="${c.key}">${c.label}<span class="arrow">${arrow}</span></th>`;
  }).join("") + "</tr>";
  const cls = v => (v == null ? "zero" : v > 0 ? "up" : v < 0 ? "down" : "zero");
  $("#table tbody").innerHTML = rows.map((r, i) => "<tr>" + cols.map(c => {
    switch (c.key) {
      case "rank": return `<td>${i + 1}</td>`;
      case "market": return `<td class="l">${r.market}</td>`;
      case "kind": return `<td class="l"><span class="badge">${r.kind}</span></td>`;
      case "name": return `<td class="l name"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a></td>`;
      case "dview": case "dchat": return `<td class="${cls(r[c.key])}">${signed(r[c.key])}</td>`;
      default: return `<td>${fmt(r[c.key])}</td>`;
    }
  }).join("") + "</tr>").join("") || `<tr><td colspan="${cols.length}" class="l zero">표시할 작품이 없습니다</td></tr>`;

  const last = activeMarkets().map(m => latestOf(m.id)).filter(Boolean).map(d => d.date).sort().pop();
  $("#table-sub").textContent = last ? `${last} 수집 기준 · ${fmt(rows.length)}개 · 증감은 직전 수집 대비 · 제목을 누르면 정렬` : "";
}

function render() {
  renderTabs(); renderUpdated(); renderCards(); renderCharts(); renderTable();
}

// ───────── 이벤트 ─────────
function bindSeg(id, key, parse = v => v) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    $(id).querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    state[key] = parse(b.dataset.v);
    if (key === "metric") state.sort = null;
    renderCharts(); renderTable();
  });
}
bindSeg("#metric", "metric");
bindSeg("#range", "range", Number);

$("#tabs").addEventListener("click", e => {
  const a = e.target.closest("a"); if (!a) return;
  e.preventDefault();
  state.market = a.dataset.id; state.sort = null;
  history.replaceState(null, "", `?market=${state.market}`);
  render();
});
$("#search").addEventListener("input", e => { state.search = e.target.value; renderTable(); });
$("#table thead").addEventListener("click", e => {
  const th = e.target.closest("th"); if (!th || th.dataset.key === "rank") return;
  const key = th.dataset.key;
  const cur = currentRows().sort;
  state.sort = { key, dir: cur.key === key ? -cur.dir : (["name", "kind", "market"].includes(key) ? 1 : -1) };
  renderTable();
});
$("#csv").addEventListener("click", () => {
  const { rows } = currentRows();
  const head = ["국가", "구분", "작품", "View", "Chat", "View 증감", "Chat 증감", "링크"];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map(r => [r.market, r.kind, r.name, r.view, r.chat, r.dview, r.dchat, r.url].map(q).join(","));
  const blob = new Blob(["﻿" + [head.map(q).join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `toptoon-${state.market}-${kstToday()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderCharts, 150); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCharts);

async function refresh() { await loadAll(); render(); }
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
