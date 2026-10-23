let isOpen = false;
let latestReport = null;
let isGenerating = false;
let statusMessage = "";
let reportLoadInFlight = false;
let sessionVersion = 0;
let lastAttempt = 0;
let currentIdentity = "";
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function readStorage(key, fallback = "") {
  try {
    const value = window.localStorage?.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

const css = `
#morning-report-root{font-family:"Noto Sans KR",system-ui,sans-serif;color:#e5e7eb}
.mr-fab{position:fixed;left:18px;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);z-index:920;display:flex;align-items:center;gap:7px;min-height:36px;padding:7px 11px;border:1px solid rgba(56,189,248,.42);border-radius:999px;background:rgba(15,23,42,.92);box-shadow:0 14px 34px rgba(0,0,0,.3);color:#e5e7eb;font-family:inherit;cursor:pointer;backdrop-filter:blur(14px);max-width:calc(100vw - 36px);touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.mr-fab:hover{background:rgba(20,32,55,.98);transform:translateY(-1px)}
.mr-dot{width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.12)}
.mr-fab strong{font-size:12px;color:#f8fafc;white-space:nowrap}
.mr-fab span{font-size:12px;font-weight:800}
.mr-pos{color:#34d399}.mr-neg{color:#f87171}
.mr-overlay{position:fixed;inset:0;z-index:1200;display:grid;align-items:end;justify-items:end;padding:18px;background:rgba(2,6,23,.26);backdrop-filter:blur(2px)}
.mr-panel{width:min(680px,calc(100vw - 28px));max-height:min(78vh,720px);overflow:auto;border:1px solid rgba(148,163,184,.2);background:linear-gradient(135deg,rgba(15,23,42,.98),rgba(17,34,64,.97));border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.52);overscroll-behavior:contain}
.mr-head{position:sticky;top:0;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 16px 12px;background:linear-gradient(135deg,rgba(15,23,42,.98),rgba(17,34,64,.97));border-bottom:1px solid rgba(148,163,184,.14)}
.mr-title{display:flex;flex-direction:column;gap:4px}.mr-title strong{font-size:17px;color:#f8fafc}.mr-title span,.mr-meta{font-size:11px;color:#94a3b8}
.mr-close{width:30px;height:30px;display:grid;place-items:center;flex:0 0 auto;border:1px solid rgba(148,163,184,.18);border-radius:9px;background:rgba(255,255,255,.06);color:#94a3b8;cursor:pointer}
.mr-close:hover{background:rgba(255,255,255,.1);color:#f8fafc}
.mr-summary{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.12)}
.mr-total{text-align:right}.mr-total strong{display:block;font-size:24px}.mr-total span{font-size:13px;font-weight:800}
.mr-grid{display:grid;grid-template-columns:1fr;gap:8px;padding:14px 16px}
.mr-row{display:grid;grid-template-columns:82px 1fr 94px;align-items:center;gap:10px;border:1px solid rgba(148,163,184,.12);background:rgba(255,255,255,.04);border-radius:10px;padding:10px}
.mr-symbol strong{display:block;color:#f8fafc}.mr-symbol span{font-size:10px;color:#64748b}
.mr-chart{width:100%;height:44px}.mr-chart polyline{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.mr-metric{text-align:right;font-size:12px;font-weight:800}.mr-metric small{display:block;margin-top:3px;color:#64748b;font-weight:700;overflow-wrap:anywhere}
.mr-empty{font-size:12px;color:#94a3b8;line-height:1.6;padding:16px}
@media(max-width:760px){.mr-fab{left:calc(env(safe-area-inset-left,0px) + 10px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);min-height:34px;padding:7px 9px;gap:6px}.mr-fab strong{font-size:11px}.mr-fab span{font-size:11px}.mr-overlay{padding:0;align-items:end;justify-items:stretch;background:rgba(2,6,23,.34)}.mr-panel{width:100%;max-height:min(82vh,680px);border-right:0;border-left:0;border-bottom:0;border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}.mr-head{padding:14px 14px 11px}.mr-summary{grid-template-columns:1fr;padding:12px 14px}.mr-total{text-align:left}.mr-grid{padding:12px 14px}.mr-row{grid-template-columns:72px 1fr;padding:9px}.mr-metric{grid-column:1 / 3;text-align:left;display:flex;align-items:center;gap:10px}.mr-metric small{margin-top:0}}
@media(max-width:420px){.mr-fab{min-height:44px}.mr-fab span:not(.mr-dot){display:none}}
`;

function fmtUsd(v) {
  if (!Number.isFinite(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return sign + new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtPrice(v) {
  if (!Number.isFinite(v)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}

function chartPath(bars) {
  if (!bars || bars.length < 2) return "";
  const width = 180;
  const height = 44;
  const closes = bars.map((b) => Number(b.close)).filter((v) => Number.isFinite(v));
  if (closes.length < 2) return "";
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  return closes.map((close, index) => `${((index / (closes.length - 1)) * width).toFixed(1)},${(height - ((close - min) / range) * 36 - 4).toFixed(1)}`).join(" ");
}

function ensureStyle() {
  if (document.getElementById("morning-report-style")) return;
  const style = document.createElement("style");
  style.id = "morning-report-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function setOpen(next) {
  isOpen = next;
  render(latestReport);
  if (next) { document.getElementById("mr-close")?.focus(); loadReport({ force:true }); }
  else document.getElementById("mr-fab")?.focus();
}

function attachEvents() {
  document.getElementById("mr-fab")?.addEventListener("click", () => setOpen(true));
  document.getElementById("mr-close")?.addEventListener("click", () => setOpen(false));
  document.getElementById("mr-overlay")?.addEventListener("click", (event) => {
    if (event.target?.id === "mr-overlay") setOpen(false);
  });
  document.getElementById("mr-refresh")?.addEventListener("click", () => loadReport({ force:true, retry:true }));
  document.removeEventListener("keydown", handleEscape);
  document.addEventListener("keydown", handleEscape);
}

function handleEscape(event) {
  if (event.key === "Escape" && isOpen) setOpen(false);
  if (event.key === "Tab" && isOpen) {
    const buttons = [...document.querySelectorAll(".mr-panel button:not(:disabled)")];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}

function panelHtml(report, rows) {
  if (!isOpen) return "";
  if (!report) {
    return `
      <div id="mr-overlay" class="mr-overlay">
        <section class="mr-panel" role="dialog" aria-modal="true" aria-label="미국장 마감 리포트">
          <div class="mr-head">
            <div class="mr-title"><strong>미국장 마감 리포트</strong><span>보유 미국 주식 기준 리포트를 기다리는 중</span></div>
            <button id="mr-close" class="mr-close" type="button" aria-label="닫기">×</button>
          </div>
          <div class="mr-empty">${escapeHtml(statusMessage || "최근 완료된 미국 거래일을 확인하고 있습니다.")}</div>
        </section>
      </div>`;
  }

  return `
    <div id="mr-overlay" class="mr-overlay">
      <section class="mr-panel" role="dialog" aria-modal="true" aria-label="미국장 마감 리포트">
        <div class="mr-head">
          <div class="mr-title">
            <strong>미국장 마감 리포트</strong>
            <span>${escapeHtml(report.market_session_date)} 미국 거래일 · 전일 종가 대비</span>
          </div>
          <button id="mr-close" class="mr-close" type="button" aria-label="닫기">×</button>
        </div>
        <div class="mr-summary">
          <div class="mr-meta">현재 보유수량 기준 예상 변동액(USD) · 환율·배당·거래 내역 제외<br>차트: 최근 10거래일 종가</div>
          <div class="mr-total">
            <strong class="${(report.total_change || 0) >= 0 ? "mr-pos" : "mr-neg"}">${fmtUsd(report.total_change)}</strong>
            <span class="${(report.total_change_pct || 0) >= 0 ? "mr-pos" : "mr-neg"}">${fmtPct(report.total_change_pct)}</span>
          </div>
        </div>
        ${
          rows.length
            ? `<div class="mr-grid">${rows
                .map((symbol) => {
                  const hasData = symbol.status === "ok";
                  const positive = (symbol.changePct || 0) >= 0;
                  return `<article class="mr-row">
                    <div class="mr-symbol"><strong>${escapeHtml(symbol.symbol)}</strong><span>${escapeHtml(symbol.name)}</span></div>
                    <svg class="mr-chart" viewBox="0 0 180 44" role="img" aria-label="${escapeHtml(symbol.symbol)} 최근 종가 추이">
                      ${hasData ? `<polyline points="${chartPath(symbol.chartBars)}" stroke="${positive ? "#34d399" : "#f87171"}"></polyline>` : ""}
                    </svg>
                    <div class="mr-metric ${hasData ? (positive ? "mr-pos" : "mr-neg") : ""}">${hasData ? fmtPct(symbol.changePct) : "데이터 없음"}<small>${hasData ? `${fmtUsd(symbol.positionImpact)} · ${fmtPrice(symbol.previousClose)}→${fmtPrice(symbol.close)}` : escapeHtml(symbol.message || "정규장 데이터 없음")}</small></div>
                  </article>`;
                })
                .join("")}</div>`
            : `<div class="mr-empty">${escapeHtml(report.provider_status?.message || "표시할 정규장 데이터가 없습니다.")}</div>`
        }
      </section>
    </div>`;
}

function render(report) {
  latestReport = report;
  const root = document.getElementById("morning-report-root");
  if (!root) return;
  ensureStyle();

  const rows = [...(report?.per_symbol_metrics || [])]
    .sort((a, b) => {
      if (a.status === "ok" && b.status !== "ok") return -1;
      if (a.status !== "ok" && b.status === "ok") return 1;
      return Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0);
    });
  const tone = (report?.total_change || 0) >= 0 ? "mr-pos" : "mr-neg";

  const focusId = root.contains(document.activeElement) ? document.activeElement.id : null;
  const oldScroll = root.querySelector(".mr-panel")?.scrollTop || 0;
  root.innerHTML = `
    <button id="mr-fab" class="mr-fab" type="button" aria-label="아침 리포트 열기" aria-expanded="${isOpen ? "true" : "false"}">
      <span class="mr-dot"></span>
      <strong>아침 리포트</strong>
      <span class="${tone}">${report ? fmtPct(report.total_change_pct) : isGenerating ? "생성중" : "대기"}</span>
    </button>
    ${panelHtml(report, rows)}`;
  const panel = root.querySelector(".mr-panel");
  if (panel) {
    const footer = document.createElement("div");
    footer.className = "mr-empty";
    footer.innerHTML = `<div role="status">${escapeHtml(statusMessage || report?.provider_status?.message || "")}</div><button id="mr-refresh" type="button" ${isGenerating ? "disabled" : ""}>${isGenerating ? "갱신 중…" : "새로고침"}</button>`;
    panel.appendChild(footer);
  }
  attachEvents();
  if (panel) panel.scrollTop = oldScroll;
  if (focusId) document.getElementById(focusId)?.focus();
}

async function getFirebaseIdToken() {
  try {
    if (!window.firebaseAuth) return null;
    if (!window.firebaseAuth.currentUser?.()) await window.firebaseAuth.signInAnonymously();
    return await window.firebaseAuth.getIdToken();
  } catch {
    return null;
  }
}

function identity() {
  return [readStorage("pm_synckey"), readStorage("pm_sync_hash"), readStorage("pm_data_path"), readStorage("pm_auth_mode")].join("|");
}

async function loadReport({ force = false, retry = false } = {}) {
  const nextIdentity = identity();
  if (nextIdentity !== currentIdentity) {
    currentIdentity = nextIdentity;
    sessionVersion++;
    latestReport = null;
    isOpen = false;
    statusMessage = "";
    lastAttempt = 0;
    reportLoadInFlight = false;
    isGenerating = false;
  }
  const syncKey = readStorage("pm_synckey");
  const root = document.getElementById("morning-report-root");
  if (!syncKey) { if (root) root.innerHTML = ""; return; }
  if (reportLoadInFlight || (!force && !isPageVisible())) return;
  if (!retry && Date.now() - lastAttempt < 60_000) return;
  lastAttempt = Date.now();
  reportLoadInFlight = true;
  const version = sessionVersion;
  const active = () => version === sessionVersion && nextIdentity === identity();
  const dataKey = readStorage("pm_sync_hash", syncKey) || syncKey;
  const dataPath = readStorage("pm_data_path", `users/${dataKey}`);
  const legacy = readStorage("pm_auth_mode") === "legacy-key" || (dataKey === syncKey && dataPath === `users/${syncKey}`);
  isGenerating = true;
  statusMessage = "최근 완료된 거래일의 종가를 확인하는 중입니다…";
  render(latestReport);
  try {
    // Restore a useful report while refreshing; never display the old intraday calculation as daily change.
    if (!latestReport && window.firebaseDB) {
      try {
        const db = window.firebaseDB.getDatabase();
        const cached = await Promise.race([
          window.firebaseDB.get(window.firebaseDB.ref(db, `${dataPath}/morningReport/latest`)).then(s => s.val()),
          new Promise(resolve => setTimeout(() => resolve(null), 3000))
        ]);
        if (!active()) return;
        if (cached?.schema_version === 2) render(cached);
      } catch { /* The authenticated API below is the source of truth. */ }
    }
    const token = legacy ? null : await getFirebaseIdToken();
    if (!active()) return;
    if (!legacy && !token) throw new Error("로그인 연결을 확인한 후 다시 시도해 주세요.");
    const response = await fetch(`/api/cron/morning-report?${legacy ? "syncKey" : "dataKey"}=${encodeURIComponent(legacy ? syncKey : dataKey)}`, {
      cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(60_000)
    });
    const data = await response.json().catch(() => ({}));
    if (!active()) return;
    if (!response.ok || !data.ok || data.report?.schema_version !== 2) throw new Error(data.error || "리포트를 불러오지 못했습니다.");
    statusMessage = "";
    const seenKey = `pm_morning_seen:${dataKey}`;
    const hour = Number(new Intl.DateTimeFormat("en", {timeZone:"Asia/Seoul", hour:"numeric", hourCycle:"h23"}).format(new Date()));
    const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul"}).format(new Date());
    const ageDays = (new Date(`${today}T12:00:00Z`) - new Date(`${data.report.market_session_date}T12:00:00Z`)) / 86400000;
    const autoOpen = isPageVisible() && hour >= 7 && hour < 12 && ageDays <= 1 && data.report.per_symbol_metrics?.some(s => s.status === "ok") && readStorage(seenKey) !== data.report.market_session_date;
    if (autoOpen) {
      isOpen = true;
      try { window.localStorage.setItem(seenKey, data.report.market_session_date); } catch {}
    }
    render(data.report);
    if (autoOpen) document.getElementById("mr-close")?.focus();
  } catch (error) {
    if (!active()) return;
    statusMessage = `${latestReport ? "이전 리포트 표시 중 · " : ""}${error?.name === "TimeoutError" ? "응답이 지연되고 있습니다. 새로고침해 주세요." : error?.message || "조회 실패"}`;
  } finally {
    if (active()) {
      reportLoadInFlight = false;
      isGenerating = false;
      render(latestReport);
    }
  }
}

window.addEventListener("load", () => loadReport({ force:true }));
window.addEventListener("portfolio-session-change", () => loadReport({ force:true, retry:true }));
window.addEventListener("storage", () => loadReport({ force:true }));
window.addEventListener("online", () => loadReport({ force:true, retry:true }));
document.addEventListener("visibilitychange", () => { if (isPageVisible()) loadReport({ force:true }); });
setTimeout(() => loadReport({ force:true }), 1500);
setInterval(() => loadReport(), 5 * 60 * 1000);

// localStorage events do not fire in the tab that changes the session.
setInterval(() => { if (identity() !== currentIdentity) loadReport({ force:true }); }, 1000);
