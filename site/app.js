"use strict";

// ───────── 설정 ─────────
const MARKETS = [
  { id: "kr", name: "한국", color: "--s1" },
  { id: "jp", name: "일본", color: "--s4" },
  { id: "tw", name: "대만", color: "--s2" },
  { id: "us", name: "미국", color: "--s3" },
];
const TABS = [{ id: "all", name: "종합" }, ...MARKETS];
const REFRESH_MS = 10 * 60 * 1000;

const state = {
  market: new URLSearchParams(location.search).get("market") || "all",
  range: 0, // 0 = 전체(첫 수집일부터)
  search: "",
  date: null,
  sort: null,
  data: {},
  imetric: "chat", // 국가 탭 캐릭터·작품별 그래프 지표
  imode: "abs",    // abs 누적 / gain 일 순증 / share 순증 점유율
};
// 일본·대만·미국 이름 옆 괄호: 캐릭터는 같은 번호의 한국판 이름, 한국판이 없으면 번역(ko.js)
let krNameCache = null;
function krName(key) {
  const days = state.data.kr?.days || [];
  if (!krNameCache || krNameCache.n !== days.length) {
    const map = {};
    for (const day of days) for (const [k, v] of Object.entries(day.items)) if (v[0]) map[k] = v[0];
    krNameCache = { n: days.length, map };
  }
  return krNameCache.map[key];
}
const koName = (m, key, name) => {
  if (m === "kr") return name;
  const t = (key.startsWith("character:") && krName(key)) || window.KO?.[m]?.[key];
  return t && t !== name ? `${name} (${t})` : name;
};
// 캐릭터별 그래프: 이름이 확실히 다른 8색. 한 탭 안에서는 보기·지표를 바꿔도 같은 캐릭터 = 같은 색
const ITEM_COLORS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"];
const TOP_N = ITEM_COLORS.length;
if (!TABS.some(t => t.id === state.market)) state.market = "all";

// ───────── 유틸 ─────────
const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const nf = new Intl.NumberFormat("ko-KR");
const fmt = n => (n == null ? "—" : nf.format(Math.round(n)));
const signed = n => (n == null ? "—" : (n > 0 ? "+" : "") + fmt(n));
function short(n) {
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, "") + "억";
  if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "만";
  return nf.format(n);
}
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
// 여러 해에 걸치면 연도도 표시
const mdy = (d, multiYear) => (multiYear ? `${d.slice(2, 4)}.` : "") + md(d);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ───────── 데이터 ─────────
// 집계 기준: 매일 사이트에 공개된 전체 작품(캐릭터·작품)의 합계. 직접 수집한 날만 사용합니다.
const counted = day => Object.keys(day.items);
function prepare(raw, id) {
  const days = (raw.days || []).filter(d => !d.imported).sort((a, b) => a.date.localeCompare(b.date));
  const abs = days.map(d => {
    let v = 0, c = 0;
    for (const k of counted(d)) { const it = d.items[k]; if (it) { v += it[1]; c += it[2]; } }
    return { view: v, chat: c };
  });
  return { source: raw.source, days, abs };
}

// 순증: 직전 수집과의 차이를 24시간 기준으로 환산(수집 시각이 밀려도 같은 잣대로 비교)
const MIN_GAP_H = 6; // 이보다 짧은 간격은 환산 오차가 커서 순증을 표시하지 않음
function gainAt(d, i, key) {
  if (i <= 0) return null;
  const hours = (new Date(d.days[i].captured_at) - new Date(d.days[i - 1].captured_at)) / 3600e3;
  const raw = d.abs[i][key] - d.abs[i - 1][key];
  if (!(hours >= MIN_GAP_H)) return { raw, hours, norm: null };
  return { raw, hours, norm: Math.round(raw * 24 / hours) };
}
const hrs = h => (h >= 47.5 ? `${(h / 24).toFixed(1)}일` : `${Math.round(h)}시간`);

async function loadAll() {
  const bust = "?t=" + Math.floor(Date.now() / 60000);
  const results = await Promise.all(MARKETS.map(async m => {
    try {
      const r = await fetch(`data/${m.id}.json${bust}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return [m.id, prepare(await r.json(), m.id)];
    } catch {
      return [m.id, state.data[m.id] || prepare({ days: [] }, m.id)];
    }
  }));
  state.data = Object.fromEntries(results);
}

// ───────── 국가 카드: View(위)·Chat(아래) 두 칸, 날짜 축 공유 ─────────
function niceTicks(min, max, count = 3) {
  if (max === min) { max += Math.max(1, max * 0.01); min -= Math.max(1, min * 0.01); }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 1e-6; t += step) ticks.push(t);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function drawCountry(card, m) {
  const d = state.data[m.id];
  const body = card.querySelector(".plot");
  const idx = d.days.map((_, i) => i);
  const sel = state.range ? idx.slice(-state.range) : idx;
  if (!sel.length) { body.innerHTML = `<div class="empty">아직 수집된 데이터가 없습니다</div>`; return; }

  const color = css(m.color);
  const W = body.clientWidth || 520, H = body.clientHeight || 380;
  // 각 지표 칸 = 그날 순증 막대(24시간 기준 환산). 누적값은 카드 위쪽 숫자로만 표시
  const pad = { l: 56, r: 76, t: 22, b: 22, gap: 34 };
  const ph = (H - pad.t - pad.b - pad.gap) / 2;
  const iw = W - pad.l - pad.r;
  const step = sel.length > 1 ? iw / (sel.length - 1) : 0;
  const x = k => pad.l + (sel.length > 1 ? step * k : iw / 2);
  const panels = [
    { key: "view", label: "View 순증", top: pad.t },
    { key: "chat", label: "Chat 순증", top: pad.t + ph + pad.gap },
  ];
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.name} View·Chat 일별 순증">`;

  for (const p of panels) {
    svg += `<text class="plabel" x="${pad.l}" y="${p.top - 8}">${p.label}</text>`;
    const gains = sel.map(i => gainAt(d, i, p.key)?.norm ?? null);
    const gv = gains.filter(v => v != null);
    if (!gv.length) {
      svg += `<text class="gainlabel" x="${pad.l + iw / 2}" y="${p.top + ph / 2}" text-anchor="middle">수집이 2일 이상 쌓이면 표시됩니다</text>`;
      continue;
    }
    const ticks = niceTicks(Math.min(0, ...gv), Math.max(0, ...gv, 1));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const y = v => p.top + ph - ((v - lo) / (hi - lo || 1)) * ph;
    svg += `<g class="axis">`;
    const tl = ticks.map(short), lab = new Set(tl).size < tl.length ? ticks.map(fmt) : tl; for (const [ti, t] of ticks.entries()) {
      svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${lab[ti]}</text>`;
    }
    svg += `</g>`;
    const bw = Math.max(2, Math.min(18, (sel.length > 1 ? step : iw) * 0.6));
    gains.forEach((g, k) => {
      if (g == null || g === 0) return;
      const y0 = y(0), y1 = y(g), h = Math.abs(y0 - y1), top = Math.min(y0, y1), r = Math.min(4, h / 2, bw / 2);
      const x0 = x(k) - bw / 2;
      svg += g > 0
        ? `<path d="M${x0},${y0}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${y0}Z" fill="${color}"/>`
        : `<rect x="${x0}" y="${top}" width="${bw}" height="${h}" fill="${css("--down")}"/>`;
    });
    svg += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    const lastK = gains.length - 1, lastG = gains[lastK];
    if (lastG != null) svg += `<text class="endlabel" x="${x(lastK) + bw / 2 + 6}" y="${y(lastG) + 4}">${(lastG > 0 ? "+" : "") + short(lastG)}</text>`;
  }
  // 날짜 축
  const every = Math.max(1, Math.ceil(sel.length / Math.max(2, Math.floor(iw / 70))));
  const multiYear = sel.length && d.days[sel[0]].date.slice(0, 4) !== d.days[sel[sel.length - 1]].date.slice(0, 4);
  svg += `<g class="axis">`;
  sel.forEach((i, k) => {
    if (k % every === 0 || k === sel.length - 1)
      svg += `<text x="${x(k)}" y="${H - 4}" text-anchor="middle">${mdy(d.days[i].date, multiYear)}</text>`;
  });
  svg += `</g>`;
  svg += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${pad.l - step / 2}" y="${pad.t}" width="${iw + step}" height="${H - pad.t - pad.b}"/>`;
  svg += `</svg>`;
  body.innerHTML = svg;

  const s = body.querySelector("svg"), cross = s.querySelector(".cross"), tip = $("#tip");
  s.querySelector(".hit").addEventListener("mousemove", e => {
    const r = s.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    const k = Math.max(0, Math.min(sel.length - 1, Math.round((px - pad.l) / (step || 1))));
    const i = sel[k], a = d.abs[i];
    cross.setAttribute("x1", x(k)); cross.setAttribute("x2", x(k)); cross.setAttribute("visibility", "visible");
    const g = { view: gainAt(d, i, "view"), chat: gainAt(d, i, "chat") };
    const capt = new Date(d.days[i].captured_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const row = (key, label) => `<div class="row"><span>${label}</span><span>${fmt(a[key])}</span></div>` +
      (g[key] ? `<div class="row sub"><span>순증(24h 환산)</span><span>${g[key].norm == null ? "—" : signed(g[key].norm)}</span></div>` +
        `<div class="row sub"><span>실제 증가 · ${hrs(g[key].hours)}</span><span>${signed(g[key].raw)}</span></div>` : "");
    tip.innerHTML = `<b>${m.name} · ${capt} 수집 · ${counted(d.days[i]).length}개 작품</b>` + row("view", "View") + row("chat", "Chat");
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = e.clientY + 14 + "px";
  });
  s.querySelector(".hit").addEventListener("mouseleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}

function renderAll() {
  const box = $("#countries");
  box.innerHTML = MARKETS.map(m => {
    const d = state.data[m.id], n = d.days.length;
    const cur = n ? d.abs[n - 1] : null;
    const stat = (k, label) => {
      const g = gainAt(d, n - 1, k), v = g?.norm;
      const tipText = g ? `실제 ${signed(g.raw)} (${hrs(g.hours)} 동안)` : "";
      return `<div class="stat"><span class="k">${label}</span><span class="v">${fmt(cur?.[k])}</span>` +
        `<span class="d${v != null && v < 0 ? " down" : ""}" title="${tipText}">${v != null ? signed(v) : ""}</span></div>`;
    };
    return `<article class="panel country" data-id="${m.id}">
      <div class="chead"><h2><i style="background:var(${m.color})"></i>${m.name}</h2>
        <div class="stats">${stat("view", "View")}${stat("chat", "Chat")}</div></div>
      <div class="plot"></div></article>`;
  }).join("");
  box.querySelectorAll(".country").forEach(card => drawCountry(card, MARKETS.find(m => m.id === card.dataset.id)));
}

// ───────── 국가 탭: 작품별 원자료 ─────────
function renderMarket() {
  const d = state.data[state.market];
  const dates = d.days.map(x => x.date);
  if (!state.date || !dates.includes(state.date)) state.date = dates[dates.length - 1] || null;
  $("#date").innerHTML = dates.slice().reverse().map(x => `<option ${x === state.date ? "selected" : ""}>${x}</option>`).join("");
  drawItems();
  renderTable();
}

// ───────── 국가 탭: 캐릭터·작품별 여러 선 ─────────
function itemValue(d, i, k, mi, mode) {
  const it = d.days[i].items[k];
  if (!it) return null;
  if (mode === "abs") return it[mi];
  if (i < 1) return null;
  const p = d.days[i - 1].items[k];
  const hours = (new Date(d.days[i].captured_at) - new Date(d.days[i - 1].captured_at)) / 3600e3;
  if (!p || !(hours >= MIN_GAP_H)) return null;
  const raw = it[mi] - p[mi];
  if (mode === "gain") return Math.round(raw * 24 / hours);
  const tot = gainAt(d, i, mi === 1 ? "view" : "chat")?.raw;
  return tot > 0 ? (raw / tot) * 100 : null;
}

function drawItems() {
  const el = $("#plot-items"), d = state.data[state.market], days = d.days;
  const mi = state.imetric === "view" ? 1 : 2, mode = state.imode, ml = state.imetric === "view" ? "View" : "Chat";
  if (!days.length) { el.innerHTML = `<div class="empty">아직 수집된 데이터가 없습니다</div>`; $("#items-legend").innerHTML = ""; $("#items-sub").textContent = ""; return; }
  // 선정: Chat·View 각각의 누적 상위와 증가량 상위를 번갈아 골라 8개로 고정 → 보기·지표를 바꿔도 같은 캐릭터, 같은 색
  const last = days.at(-1).items;
  const rank = (m, growth) => Object.keys(last).sort((a, b) => {
    const sc = k => { if (!growth || days.length < 2) return last[k][m]; const f = days.find(x => x.items[k]); return last[k][m] - f.items[k][m]; };
    return sc(b) - sc(a);
  });
  const lists = [rank(2, false), rank(2, true), rank(1, false), rank(1, true)];
  const order = [0, 1, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1];
  const keys = [];
  const want = Math.min(TOP_N, Object.keys(last).length);
  while (keys.length < want) {
    for (const li of order) {
      const k = lists[li].find(x => !keys.includes(x));
      if (k && keys.length < want) keys.push(k);
    }
  }
  $("#items-sub").textContent = `Chat·View 누적·증가량 상위 ${keys.length}개 · 보기·지표를 바꿔도 색은 그대로`;
  const series = keys.map((k, j) => ({ k, name: koName(state.market, k, last[k][0] || k), kind: k.startsWith("content") ? "작품" : "캐릭터", color: css(ITEM_COLORS[j]),
    vals: days.map((_, i) => itemValue(d, i, k, mi, mode)) }));
  const all = series.flatMap(s => s.vals).filter(v => v != null);
  if (!all.length) { el.innerHTML = `<div class="empty">순증은 수집이 2일 이상 쌓이면 표시됩니다</div>`; $("#items-legend").innerHTML = ""; return; }

  const W = el.clientWidth || 800, H = el.clientHeight || 380;
  const pad = { l: 56, r: 76, t: 14, b: 22 };
  const ph = H - pad.t - pad.b, iw = W - pad.l - pad.r;
  const n = days.length, step = n > 1 ? iw / (n - 1) : 0;
  const x = i => pad.l + (n > 1 ? step * i : iw / 2);
  const ticks = mode === "abs" ? niceTicks(Math.min(...all), Math.max(...all)) : niceTicks(Math.min(0, ...all), Math.max(0, ...all, 1));
  const lo = ticks[0], hi = ticks.at(-1);
  const y = v => pad.t + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const lbl = v => (mode === "share" ? `${v.toFixed(0)}%` : short(v));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="캐릭터·작품별 ${ml}">`;
  svg += `<g class="axis">`;
  const tl = ticks.map(t => (mode === "share" ? `${t}%` : short(t))), lab = new Set(tl).size < tl.length ? ticks.map(fmt) : tl;
  ticks.forEach((t, ti) => {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${lab[ti]}</text>`;
  });
  if (mode !== "abs") svg += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  const multiYear = days[0].date.slice(0, 4) !== days.at(-1).date.slice(0, 4);
  days.forEach((dd, i) => { if (i % every === 0 || i === n - 1) svg += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${mdy(dd.date, multiYear)}</text>`; });
  svg += `</g>`;
  const labels = [];
  for (const se of series) {
    const pts = se.vals.map((v, i) => (v == null ? null : [x(i), y(v)]));
    let path = "", pen = false;
    pts.forEach(q => { if (!q) { pen = false; return; } path += (pen ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1); pen = true; });
    if (path.includes("L")) svg += `<path d="${path}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const li = se.vals.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).pop();
    if (li == null || li < 0) continue;
    svg += `<circle cx="${x(li)}" cy="${y(se.vals[li])}" r="3" fill="${se.color}"/>`;
    labels.push({ y: y(se.vals[li]), text: lbl(se.vals[li]), color: se.color });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  const maxY = H - pad.b - 2;
  if (labels.length && labels.at(-1).y > maxY) { labels.at(-1).y = maxY; for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - 13); }
  for (const l of labels) svg += `<text class="endlabel" x="${W - pad.r + 8}" y="${l.y + 4}" style="fill:${l.color}">${l.text}</text>`;
  svg += `<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${pad.l - step / 2}" y="${pad.t}" width="${iw + step}" height="${ph}"/></svg>`;
  el.innerHTML = svg;

  const s = el.querySelector("svg"), cross = s.querySelector(".cross"), tip = $("#tip");
  const unit = v => (mode === "share" ? `${v.toFixed(1)}%` : mode === "gain" ? signed(v) : fmt(v));
  s.querySelector(".hit").addEventListener("mousemove", e => {
    const r = s.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) * (W / r.width) - pad.l) / (step || 1))));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    const rows = series.map(se => ({ se, v: se.vals[i] })).filter(q => q.v != null).sort((a, b) => b.v - a.v);
    const title = { abs: `${ml} 누적`, gain: `${ml} 일 순증(24h 환산)`, share: `${ml} 순증 점유율` }[mode];
    tip.innerHTML = `<b>${days[i].date} · ${title}</b>` + (rows.length
      ? rows.map(q => `<div class="row"><span><i style="background:${q.se.color}"></i>${esc(q.se.name)}</span><span>${unit(q.v)}</span></div>`).join("")
      : `<div class="row sub"><span>표시할 값이 없습니다</span><span></span></div>`);
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = e.clientY + 14 + "px";
  });
  s.querySelector(".hit").addEventListener("mouseleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  $("#items-legend").innerHTML = series.map(se => `<span><i style="background:${se.color}"></i>${esc(se.name)} <small>${se.kind}</small></span>`).join("");
}

function currentRows() {
  const d = state.data[state.market];
  const i = d.days.findIndex(x => x.date === state.date);
  const rows = [];
  if (i >= 0) {
    const cur = d.days[i].items, prev = i > 0 ? d.days[i - 1].items : {};
    for (const key of counted(d.days[i])) {
      if (!cur[key]) continue;
      const [name, view, chat] = cur[key];
      const [kind, id] = key.split(":");
      const p = prev[key];
      rows.push({
        kind: kind === "content" ? "작품" : "캐릭터", name: koName(state.market, key, name || key), url: `${d.source}/detail/${kind}/${id}`,
        view, chat, dview: p ? view - p[1] : null, dchat: p ? chat - p[2] : null,
      });
    }
  }
  const sort = state.sort || { key: "view", dir: -1 };
  const q = state.search.trim().toLowerCase();
  const shown = q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
  shown.sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y, "ko") : x - y) * sort.dir;
  });
  return { rows, shown, sort, day: d.days[i] };
}

const COLS = [
  { key: "rank", label: "순위" },
  { key: "kind", label: "구분", l: true },
  { key: "name", label: "작품", l: true },
  { key: "view", label: "View" },
  { key: "chat", label: "Chat" },
  { key: "dview", label: "View 증감" },
  { key: "dchat", label: "Chat 증감" },
];

function renderTable() {
  const { rows, shown, sort, day } = currentRows();
  const d = state.data[state.market];
  $("#table thead").innerHTML = "<tr>" + COLS.map(c =>
    `<th class="${c.l ? "l" : ""}" data-key="${c.key}">${c.label}<span class="arrow">${sort.key === c.key ? (sort.dir < 0 ? " ▼" : " ▲") : ""}</span></th>`).join("") + "</tr>";
  const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const cls = v => (v == null ? "zero" : v > 0 ? "up" : v < 0 ? "down" : "zero");
  const total = rows.length ? `<tr class="total"><td></td><td class="l"></td><td class="l">합계 (${fmt(rows.length)}개)</td>` +
    `<td>${fmt(sum("view"))}</td><td>${fmt(sum("chat"))}</td><td>${signed(sum("dview"))}</td><td>${signed(sum("dchat"))}</td></tr>` : "";
  $("#table tbody").innerHTML = total + (shown.map((r, i) => `<tr><td>${i + 1}</td>` +
    `<td class="l"><span class="badge">${r.kind}</span></td>` +
    `<td class="l name"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a></td>` +
    `<td>${fmt(r.view)}</td><td>${fmt(r.chat)}</td>` +
    `<td class="${cls(r.dview)}">${signed(r.dview)}</td><td class="${cls(r.dchat)}">${signed(r.dchat)}</td></tr>`).join("")
    || `<tr><td colspan="7" class="l zero">표시할 작품이 없습니다</td></tr>`);
  $("#table-sub").textContent = day
    ? `${new Date(day.captured_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 · 증감은 직전 수집 대비 실제 증가` +
      (gainAt(d, d.days.indexOf(day), "view") ? ` (${hrs(gainAt(d, d.days.indexOf(day), "view").hours)} 간격)` : "") + " · 제목을 누르면 정렬"
    : "";
}

// ───────── 공통 ─────────
function renderTabs() {
  $("#tabs").innerHTML = TABS.map(t => `<a href="?market=${t.id}" data-id="${t.id}" class="${t.id === state.market ? "on" : ""}">${t.name}</a>`).join("");
  const tab = TABS.find(t => t.id === state.market);
  $("#title").textContent = `탑툰챗 트래커 · ${tab.name}`;
  document.title = $("#title").textContent;
}

function renderUpdated() {
  const lasts = MARKETS.map(m => state.data[m.id].days.at(-1)).filter(Boolean);
  if (!lasts.length) { $("#updated").textContent = "아직 수집된 데이터가 없습니다"; return; }
  const last = lasts.map(s => s.captured_at).sort().pop();
  const text = `마지막 수집 ${new Date(last).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  const kstHour = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const stale = lasts.some(s => s.date !== kstToday()) && kstHour >= 10;
  $("#updated").innerHTML = esc(text) + (stale ? ` · <span class="warn">오늘 수집이 아직 없어요</span>` : "");
}

function render() {
  renderTabs(); renderUpdated();
  const all = state.market === "all";
  $("#view-all").hidden = !all;
  $("#view-market").hidden = all;
  all ? renderAll() : renderMarket();
}

$("#range").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  $("#range").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  state.range = Number(b.dataset.v);
  renderAll();
});
$("#tabs").addEventListener("click", e => {
  const a = e.target.closest("a"); if (!a) return;
  e.preventDefault();
  state.market = a.dataset.id; state.sort = null; state.date = null; state.search = ""; $("#search").value = "";
  history.replaceState(null, "", `?market=${state.market}`);
  render();
});
$("#date").addEventListener("change", e => { state.date = e.target.value; renderTable(); });
for (const [id, key] of [["#imetric", "imetric"], ["#imode", "imode"]]) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    $(id).querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    state[key] = b.dataset.v;
    drawItems();
  });
}
$("#search").addEventListener("input", e => { state.search = e.target.value; renderTable(); });
$("#table thead").addEventListener("click", e => {
  const th = e.target.closest("th"); if (!th || th.dataset.key === "rank") return;
  const key = th.dataset.key, cur = currentRows().sort;
  state.sort = { key, dir: cur.key === key ? -cur.dir : (["name", "kind"].includes(key) ? 1 : -1) };
  renderTable();
});
$("#csv").addEventListener("click", () => {
  const { shown } = currentRows();
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["구분", "작품", "View", "Chat", "View 증감", "Chat 증감", "링크"];
  const body = shown.map(r => [r.kind, r.name, r.view, r.chat, r.dview, r.dchat, r.url].map(q).join(","));
  const blob = new Blob([String.fromCharCode(0xFEFF) + [head.map(q).join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `toptoon-${state.market}-${state.date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => (state.market === "all" ? renderAll() : drawItems()), 150); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.market === "all" && renderAll());

async function refresh() { await loadAll(); render(); }
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
