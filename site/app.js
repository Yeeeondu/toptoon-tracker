"use strict";

// ───────── 설정 ─────────
const MARKETS = [
  { id: "kr", name: "한국", color: "--s1" },
  { id: "tw", name: "대만", color: "--s2" },
  { id: "us", name: "미국", color: "--s3" },
  { id: "jp", name: "일본", color: "--s4" },
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
};
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
  const W = body.clientWidth || 520, H = body.clientHeight || 420;
  // 각 지표 칸 = 위쪽 선(누적 절대값) + 아래쪽 막대 띠(그날 순증)
  const pad = { l: 52, r: 84, t: 22, b: 22, gap: 34 }, barH = 50, barGap = 18;
  const ph = (H - pad.t - pad.b - pad.gap) / 2;
  const lh = ph - barH - barGap;
  const iw = W - pad.l - pad.r;
  const step = sel.length > 1 ? iw / (sel.length - 1) : 0;
  const x = k => pad.l + (sel.length > 1 ? step * k : iw / 2);
  const panels = [
    { key: "view", label: "View", top: pad.t },
    { key: "chat", label: "Chat", top: pad.t + ph + pad.gap },
  ];
  const surface = css("--surface");
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.name} View·Chat 절대값과 일별 순증">`;

  for (const p of panels) {
    // 선: 누적 절대값
    const vals = sel.map(i => d.abs[i][p.key]);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const y = v => p.top + lh - ((v - lo) / (hi - lo || 1)) * lh;
    svg += `<text class="plabel" x="${pad.l}" y="${p.top - 8}">${p.label}</text>`;
    svg += `<g class="axis">`;
    const tl = ticks.map(short), lab = new Set(tl).size < tl.length ? ticks.map(fmt) : tl; for (const [ti, t] of ticks.entries()) {
      svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${lab[ti]}</text>`;
    }
    svg += `</g>`;
    const pts = sel.map((i, k) => [x(k), y(d.abs[i][p.key])]);
    const path = pts.map((q, j) => (j ? "L" : "M") + q[0].toFixed(1) + "," + q[1].toFixed(1)).join("");
    if (pts.length > 1) svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts[pts.length - 1];
    svg += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${color}" stroke="${surface}" stroke-width="2"/>`;
    svg += `<text class="endlabel" x="${last[0] + 8}" y="${last[1] + 4}">${short(vals[vals.length - 1])}</text>`;

    // 막대: 그날 순증(직전 수집 대비 합계 변화)
    const bTop = p.top + lh + barGap;
    const gains = sel.map(i => gainAt(d, i, p.key)?.norm ?? null);
    const gv = gains.filter(v => v != null);
    const gLo = Math.min(0, ...gv), gHi = Math.max(0, ...gv, 1);
    const by = v => bTop + barH - ((v - gLo) / (gHi - gLo || 1)) * barH;
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${by(gHi)}" y2="${by(gHi)}"/>`;
    svg += `<g class="axis"><text x="${pad.l - 6}" y="${by(gHi) + 4}" text-anchor="end">${gv.length ? short(gHi) : ""}</text>`;
    svg += `<text x="${pad.l - 6}" y="${by(0) + 4}" text-anchor="end">0</text></g>`;
    const bw = Math.max(2, Math.min(14, (sel.length > 1 ? step : iw) * 0.6));
    gains.forEach((g, k) => {
      if (g == null || g === 0) return;
      const y0 = by(0), y1 = by(g), h = Math.abs(y0 - y1), top = Math.min(y0, y1), r = Math.min(3, h / 2, bw / 2);
      const x0 = x(k) - bw / 2;
      svg += g > 0
        ? `<path class="gainbar" d="M${x0},${y0}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${y0}Z" fill="${color}"/>`
        : `<rect class="gainbar" x="${x0}" y="${top}" width="${bw}" height="${h}" fill="${css("--down")}"/>`;
    });
    svg += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${by(0)}" y2="${by(0)}"/>`;
    const lastG = gains[gains.length - 1];
    svg += `<text class="gainlabel" x="${W - pad.r + 8}" y="${by(gHi) + 10}">일 순증(24h)</text>`;
    if (lastG != null) svg += `<text class="endlabel" x="${W - pad.r + 8}" y="${by(gHi) + 26}">${(lastG > 0 ? "+" : "") + short(lastG)}</text>`;
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
        `<span class="d${v != null && v < 0 ? " down" : ""}" title="${tipText}">${v != null ? signed(v) + " /24h" : ""}</span></div>`;
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
  renderTable();
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
        kind: kind === "content" ? "작품" : "캐릭터", name: name || key, url: `${d.source}/detail/${kind}/${id}`,
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
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => state.market === "all" && renderAll(), 150); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.market === "all" && renderAll());

async function refresh() { await loadAll(); render(); }
refresh();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
