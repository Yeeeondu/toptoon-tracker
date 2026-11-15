"use strict";

// ───────── 설정 ─────────
const MARKETS = [
  { id: "kr", name: "한국", color: "--s1" },
  { id: "tw", name: "대만", color: "--s2" },
  { id: "us", name: "미국", color: "--s3" },
  { id: "jp", name: "일본", color: "--s4" },
];
// 원본 사이트가 숫자를 잘못 읽은 작품이 많아 과거 기록을 쓰지 않는 나라
const SKIP_IMPORTED = new Set(["tw", "us"]);
const TABS = [{ id: "all", name: "종합" }, ...MARKETS];
const REFRESH_MS = 10 * 60 * 1000;

const state = {
  market: new URLSearchParams(location.search).get("market") || "all",
  range: 30,
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
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ───────── 데이터 ─────────
// 집계 기준(원본 사이트와 동일): 그날 홈·탐색·랭킹 페이지에 링크로 걸린 작품의 합계.
// 직접 수집한 날은 day.listed에 그 목록이 있고, 원본에서 가져온 날은 기록된 작품 전부가 그 목록입니다.
const counted = day => day.listed || Object.keys(day.items);
function prepare(raw, id) {
  let days = (raw.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (SKIP_IMPORTED.has(id)) days = days.filter(d => !d.imported);
  const abs = days.map(d => {
    let v = 0, c = 0;
    for (const k of counted(d)) { const it = d.items[k]; if (it) { v += it[1]; c += it[2]; } }
    return { view: v, chat: c };
  });
  return { source: raw.source, days, abs };
}

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
  const W = body.clientWidth || 520, H = 300;
  const pad = { l: 52, r: 84, t: 22, b: 22, gap: 34 };
  const ph = (H - pad.t - pad.b - pad.gap) / 2;
  const iw = W - pad.l - pad.r;
  const step = sel.length > 1 ? iw / (sel.length - 1) : 0;
  const x = k => pad.l + (sel.length > 1 ? step * k : iw / 2);
  const panels = [
    { key: "view", label: "View", top: pad.t },
    { key: "chat", label: "Chat", top: pad.t + ph + pad.gap },
  ];
  const surface = css("--surface");
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.name} View·Chat 절대값">`;

  for (const p of panels) {
    const vals = sel.map(i => d.abs[i][p.key]);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const y = v => p.top + ph - ((v - lo) / (hi - lo || 1)) * ph;
    p.y = y;
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
  }
  // 날짜 축
  const every = Math.max(1, Math.ceil(sel.length / Math.max(2, Math.floor(iw / 70))));
  svg += `<g class="axis">`;
  sel.forEach((i, k) => {
    if (k % every === 0 || k === sel.length - 1)
      svg += `<text x="${x(k)}" y="${H - 4}" text-anchor="middle">${md(d.days[i].date)}</text>`;
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
    const i = sel[k], a = d.abs[i], prev = i > 0 ? d.abs[i - 1] : null;
    cross.setAttribute("x1", x(k)); cross.setAttribute("x2", x(k)); cross.setAttribute("visibility", "visible");
    const delta = key => (prev ? ` <em>${signed(a[key] - prev[key])}</em>` : "");
    tip.innerHTML = `<b>${m.name} · ${d.days[i].date} · ${counted(d.days[i]).length}개 작품</b>` +
      `<div class="row"><span>View</span><span>${fmt(a.view)}${delta("view")}</span></div>` +
      `<div class="row"><span>Chat</span><span>${fmt(a.chat)}${delta("chat")}</span></div>`;
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
    const cur = n ? d.abs[n - 1] : null, prev = n > 1 ? d.abs[n - 2] : null;
    const stat = (k, label) => `<div class="stat"><span class="k">${label}</span><span class="v">${fmt(cur?.[k])}</span>` +
      `<span class="d${prev && cur[k] < prev[k] ? " down" : ""}">${prev ? signed(cur[k] - prev[k]) : ""}</span></div>`;
    const note = SKIP_IMPORTED.has(m.id) ? `<p class="sub">원본 사이트의 과거 기록은 숫자를 잘못 읽은 작품이 많아, 직접 수집한 날부터 표시</p>` : "";
    return `<article class="panel country" data-id="${m.id}">
      <div class="chead"><h2><i style="background:var(${m.color})"></i>${m.name}</h2>
        <div class="stats">${stat("view", "View")}${stat("chat", "Chat")}</div></div>
      ${note}<div class="plot"></div></article>`;
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
    ? `${day.imported ? "원본 사이트 기록" : "직접 수집"} · ${new Date(day.captured_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 · 증감은 직전 수집 대비 · 제목을 누르면 정렬`
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
