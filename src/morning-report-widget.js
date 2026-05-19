const STORAGE_KEY = "pm_morning_report_open";
let isOpen = localStorage.getItem(STORAGE_KEY) === "1";
let latestReport = null;

const css = `
#morning-report-root{font-family:"Noto Sans KR",system-ui,sans-serif;color:#e5e7eb}
.mr-fab{position:fixed;right:18px;bottom:92px;z-index:920;display:flex;align-items:center;gap:7px;min-height:38px;padding:8px 12px;border:1px solid rgba(56,189,248,.42);border-radius:999px;background:rgba(15,23,42,.94);box-shadow:0 18px 44px rgba(0,0,0,.34);color:#e5e7eb;font-family:inherit;cursor:pointer;backdrop-filter:blur(14px)}
.mr-fab:hover{background:rgba(20,32,55,.98);transform:translateY(-1px)}
.mr-dot{width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.12)}
.mr-fab strong{font-size:12px;color:#f8fafc;white-space:nowrap}
.mr-fab span{font-size:12px;font-weight:800}
.mr-pos{color:#34d399}.mr-neg{color:#f87171}
.mr-overlay{position:fixed;inset:0;z-index:930;display:grid;align-items:end;justify-items:end;padding:18px;background:rgba(2,6,23,.26);backdrop-filter:blur(2px)}
.mr-panel{width:min(680px,calc(100vw - 28px));max-height:min(78vh,720px);overflow:auto;border:1px solid rgba(148,163,184,.2);background:linear-gradient(135deg,rgba(15,23,42,.98),rgba(17,34,64,.97));border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.52)}
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
.mr-metric{text-align:right;font-size:12px;font-weight:800}.mr-metric small{display:block;margin-top:3px;color:#64748b;font-weight:700}
.mr-empty{font-size:12px;color:#94a3b8;line-height:1.6;padding:16px}
@media(max-width:760px){.mr-fab{right:12px;bottom:78px;min-height:34px;padding:7px 10px}.mr-fab strong{font-size:11px}.mr-overlay{padding:10px;align-items:end}.mr-panel{width:100%;max-height:82vh}.mr-summary{grid-template-columns:1fr}.mr-total{text-align:left}.mr-row{grid-template-columns:72px 1fr}.mr-metric{grid-column:1 / 3;text-align:left;display:flex;align-items:center;gap:10px}.mr-metric small{margin-top:0}}
`;

function fmtUsd(v) {
  if (typeof v !== "number") return "-";
  const sign = v > 0 ? "+" : "";
  return sign + new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}

function fmtPct(v) {
  if (typeof v !== "number") return "-";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function chartPath(bars) {
  if (!bars || bars.length < 2) return "";
  const width = 180;
  const height = 44;
  const closes = bars.map((b) => Number(b.close)).filter((v) => Number.isFinite(v));
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
  localStorage.setItem(STORAGE_KEY, isOpen ? "1" : "0");
  render(latestReport);
}

function attachEvents() {
  document.getElementById("mr-fab")?.addEventListener("click", () => setOpen(true));
  document.getElementById("mr-close")?.addEventListener("click", () => setOpen(false));
  document.getElementById("mr-overlay")?.addEventListener("click", (event) => {
    if (event.target?.id === "mr-overlay") setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) setOpen(false);
  }, { once: true });
}

function panelHtml(report, rows) {
  if (!isOpen) return "";
  if (!report) {
    return `
      <div id="mr-overlay" class="mr-overlay">
        <section class="mr-panel">
          <div class="mr-head">
            <div class="mr-title"><strong>오늘 아침 리포트</strong><span>보유 미국 주식 기준 리포트를 기다리는 중</span></div>
            <button id="mr-close" class="mr-close" type="button" aria-label="닫기">×</button>
          </div>
          <div class="mr-empty">정규장 움직임이 생성되면 이 패널에 표시됩니다.</div>
        </section>
      </div>`;
  }

  return `
    <div id="mr-overlay" class="mr-overlay">
      <section class="mr-panel">
        <div class="mr-head">
          <div class="mr-title">
            <strong>오늘 아침 리포트</strong>
            <span>${report.market_session_date || ""} 미국 정규장 09:30-16:00 ET · 보유 미국 주식 기준</span>
          </div>
          <button id="mr-close" class="mr-close" type="button" aria-label="닫기">×</button>
        </div>
        <div class="mr-summary">
          <div class="mr-meta">밤사이 포트폴리오 움직임과 등락률 상위 종목입니다.</div>
          <div class="mr-total">
            <strong class="${(report.total_change || 0) >= 0 ? "mr-pos" : "mr-neg"}">${fmtUsd(report.total_change)}</strong>
            <span class="${(report.total_change_pct || 0) >= 0 ? "mr-pos" : "mr-neg"}">${fmtPct(report.total_change_pct)}</span>
          </div>
        </div>
        ${
          rows.length
            ? `<div class="mr-grid">${rows
                .map((symbol) => {
                  const positive = (symbol.changePct || 0) >= 0;
                  return `<article class="mr-row">
                    <div class="mr-symbol"><strong>${symbol.symbol}</strong><span>${symbol.name || ""}</span></div>
                    <svg class="mr-chart" viewBox="0 0 180 44" role="img" aria-label="${symbol.symbol} intraday chart">
                      <polyline points="${chartPath(symbol.chartBars)}" stroke="${positive ? "#34d399" : "#f87171"}"></polyline>
                    </svg>
                    <div class="mr-metric ${positive ? "mr-pos" : "mr-neg"}">${fmtPct(symbol.changePct)}<small>${fmtUsd(symbol.positionImpact)}</small></div>
                  </article>`;
                })
                .join("")}</div>`
            : `<div class="mr-empty">${report.provider_status?.message || "표시할 정규장 데이터가 없습니다."}</div>`
        }
      </section>
    </div>`;
}

function render(report) {
  latestReport = report;
  const root = document.getElementById("morning-report-root");
  if (!root) return;
  ensureStyle();

  const rows = (report?.per_symbol_metrics || [])
    .filter((symbol) => symbol.status === "ok")
    .sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))
    .slice(0, 6);
  const tone = (report?.total_change || 0) >= 0 ? "mr-pos" : "mr-neg";

  root.innerHTML = `
    <button id="mr-fab" class="mr-fab" type="button" aria-expanded="${isOpen ? "true" : "false"}">
      <span class="mr-dot"></span>
      <strong>아침 리포트</strong>
      <span class="${tone}">${report ? fmtPct(report.total_change_pct) : "대기"}</span>
    </button>
    ${panelHtml(report, rows)}`;
  attachEvents();
}

async function loadReport() {
  const syncKey = localStorage.getItem("pm_synckey");
  if (!syncKey) {
    render(null);
    return;
  }
  try {
    if (window.firebaseDB) {
      const db = window.firebaseDB.getDatabase();
      const snap = await window.firebaseDB.get(window.firebaseDB.ref(db, `users/${syncKey}/morningReport/latest`));
      render(snap.val());
      return;
    }
  } catch {}
  try {
    const res = await fetch(`https://stockmanagehw-default-rtdb.firebaseio.com/users/${encodeURIComponent(syncKey)}/morningReport/latest.json`, { cache: "no-store" });
    render(await res.json());
  } catch {
    render(null);
  }
}

window.addEventListener("load", loadReport);
setTimeout(loadReport, 1500);
