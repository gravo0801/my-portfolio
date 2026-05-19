const css = `
#morning-report-root{font-family:"Noto Sans KR",system-ui,sans-serif;background:#0f172a;color:#e5e7eb}
.mr-wrap{max-width:1200px;margin:0 auto;padding:10px 20px 0}
.mr-card{border:1px solid rgba(148,163,184,.18);background:linear-gradient(135deg,rgba(15,23,42,.98),rgba(17,34,64,.96));border-radius:12px;padding:14px;box-shadow:0 16px 40px rgba(0,0,0,.24)}
.mr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.mr-title{display:flex;flex-direction:column;gap:3px}
.mr-title strong{font-size:16px;color:#f8fafc}
.mr-title span,.mr-meta{font-size:11px;color:#94a3b8}
.mr-total{text-align:right}.mr-total strong{font-size:22px}.mr-pos{color:#34d399}.mr-neg{color:#f87171}
.mr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.mr-row{display:grid;grid-template-columns:72px 1fr 88px;align-items:center;gap:10px;border:1px solid rgba(148,163,184,.12);background:rgba(255,255,255,.04);border-radius:10px;padding:10px}
.mr-symbol strong{display:block;color:#f8fafc}.mr-symbol span{font-size:10px;color:#64748b}
.mr-chart{width:100%;height:42px}.mr-chart polyline{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.mr-metric{text-align:right;font-size:12px;font-weight:800}.mr-metric small{display:block;margin-top:3px;color:#64748b;font-weight:700}
.mr-empty{font-size:12px;color:#94a3b8;line-height:1.6}
@media(max-width:760px){.mr-wrap{padding:8px 10px 0}.mr-grid{grid-template-columns:1fr}.mr-head{align-items:flex-start}.mr-total strong{font-size:18px}}
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
  const w = 180;
  const h = 42;
  const closes = bars.map((b) => Number(b.close)).filter((v) => Number.isFinite(v));
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  return closes.map((close, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(h - ((close - min) / range) * 34 - 4).toFixed(1)}`).join(" ");
}

function render(report) {
  const root = document.getElementById("morning-report-root");
  if (!root) return;
  if (!document.getElementById("morning-report-style")) {
    const style = document.createElement("style");
    style.id = "morning-report-style";
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (!report) {
    root.innerHTML = `<div class="mr-wrap"><div class="mr-card"><div class="mr-empty">오늘 아침 리포트를 기다리는 중입니다. 보유 미국 주식 기준으로 정규장 움직임이 생성되면 여기에 표시됩니다.</div></div></div>`;
    return;
  }
  const rows = (report.per_symbol_metrics || [])
    .filter((s) => s.status === "ok")
    .sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))
    .slice(0, 6);
  root.innerHTML = `
    <div class="mr-wrap">
      <section class="mr-card">
        <div class="mr-head">
          <div class="mr-title">
            <strong>오늘 아침 리포트</strong>
            <span>${report.market_session_date || ""} 미국 정규장 09:30-16:00 ET · 보유 미국 주식 기준</span>
          </div>
          <div class="mr-total">
            <div class="mr-meta">포트폴리오 변동</div>
            <strong class="${(report.total_change || 0) >= 0 ? "mr-pos" : "mr-neg"}">${fmtUsd(report.total_change)}</strong>
            <div class="${(report.total_change_pct || 0) >= 0 ? "mr-pos" : "mr-neg"}">${fmtPct(report.total_change_pct)}</div>
          </div>
        </div>
        ${
          rows.length
            ? `<div class="mr-grid">${rows
                .map((s) => {
                  const pos = (s.changePct || 0) >= 0;
                  return `<article class="mr-row">
                    <div class="mr-symbol"><strong>${s.symbol}</strong><span>${s.name || ""}</span></div>
                    <svg class="mr-chart" viewBox="0 0 180 42" role="img" aria-label="${s.symbol} intraday chart">
                      <polyline points="${chartPath(s.chartBars)}" stroke="${pos ? "#34d399" : "#f87171"}"></polyline>
                    </svg>
                    <div class="mr-metric ${pos ? "mr-pos" : "mr-neg"}">${fmtPct(s.changePct)}<small>${fmtUsd(s.positionImpact)}</small></div>
                  </article>`;
                })
                .join("")}</div>`
            : `<div class="mr-empty">${report.provider_status?.message || "표시할 정규장 데이터가 없습니다."}</div>`
        }
      </section>
    </div>`;
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
