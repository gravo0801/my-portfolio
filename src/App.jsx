import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

// Firebase SDK (loaded via index.html CDN script tags)
// Functions will be available on window after load

const CRYPTO_IDS = {
  BTC:"bitcoin",ETH:"ethereum",BNB:"binancecoin",SOL:"solana",
  XRP:"ripple",ADA:"cardano",DOGE:"dogecoin",AVAX:"avalanche-2",
  LINK:"chainlink",DOT:"polkadot",MATIC:"matic-network",UNI:"uniswap",
  ATOM:"cosmos",NEAR:"near",APT:"aptos",SUI:"sui",
};
const MARKET_LABEL = { KR:"한국주식", US:"미국주식", ETF:"ETF", CRYPTO:"암호화폐" };
const MARKET_COLOR = { KR:"#6366f1", US:"#10b981", ETF:"#f59e0b", CRYPTO:"#a855f7" };
const USD_KRW = 1380;

const fmtPrice = (n, cur) => cur === "KRW"
  ? Math.round(n).toLocaleString("ko-KR") + "₩"
  : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtPct = (n) => (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
const toKRW  = (v, cur) => cur === "KRW" ? v : v * USD_KRW;
const today  = () => new Date().toISOString().slice(0, 10);

async function fetchYahoo(ticker) {
  try {
    const url = encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`);
    const r = await fetch(`https://corsproxy.io/?url=${url}`);
    const d = await r.json();
    const m = d.chart.result[0].meta;
    const price = m.regularMarketPrice;
    const prev  = m.previousClose || m.chartPreviousClose || price;
    return { price, changePercent: ((price - prev) / prev) * 100, currency: m.currency };
  } catch { return null; }
}

async function fetchCrypto(ticker) {
  try {
    const id = CRYPTO_IDS[ticker.toUpperCase()] || ticker.toLowerCase();
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`);
    const d = await r.json();
    const info = d[id];
    return info ? { price: info.usd, changePercent: info.usd_24h_change, currency: "USD" } : null;
  } catch { return null; }
}

const S = {
  inp: {
    background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.14)",
    color: "#f1f5f9", padding: "11px 14px", borderRadius: "10px",
    fontSize: "15px", width: "100%", boxSizing: "border-box", outline: "none",
    letterSpacing: "-0.01em", lineHeight: "1.5",
  },
  btn: (bg = "#6366f1", extra = {}) => ({
    background: bg, border: "none", color: "#fff",
    padding: "10px 18px", borderRadius: "10px", cursor: "pointer",
    fontSize: "14px", fontWeight: 700, letterSpacing: "-0.01em", ...extra,
  }),
  card: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "14px", padding: "22px",
  },
  TH: {
    textAlign: "left", padding: "11px 14px",
    color: "#94a3b8", fontSize: "13px", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.07em",
    borderBottom: "1px solid rgba(255,255,255,0.09)",
  },
  TD: {
    padding: "15px 14px", fontSize: "15px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    letterSpacing: "-0.01em", lineHeight: "1.5",
  },
};

// ── Firebase helpers ──────────────────────────────────────────────────────────
let _db = null;
function getDB() {
  if (_db) return _db;
  const app = window.firebaseApp.initializeApp();
  _db = window.firebaseDB.getDatabase(app);
  return _db;
}
function dbRef(path) { return window.firebaseDB.ref(getDB(), path); }
function dbSet(path, val) { return window.firebaseDB.set(dbRef(path), val); }
function dbOn(path, cb) { return window.firebaseDB.onValue(dbRef(path), snap => cb(snap.val())); }
function dbOff(unsub) { if (typeof unsub === "function") unsub(); }

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [key, setKey]       = useState("");
  const [err, setErr]       = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const k = key.trim().toLowerCase().replace(/\s+/g, "-");
    if (k.length < 3) { setErr("동기화 키는 3자 이상이어야 합니다."); return; }
    if (!/^[a-z0-9\-]+$/.test(k)) { setErr("영문 소문자, 숫자, 하이픈(-)만 사용 가능합니다."); return; }
    setLoading(true);
    try {
      await window.firebaseDB.get(dbRef(`users/${k}/ping`));
      localStorage.setItem("pm_synckey", k);
      onLogin(k);
    } catch {
      setErr("Firebase 연결 실패. index.html 의 Firebase 설정값을 확인해주세요.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)", padding:"20px" }}>
      <div style={{ ...S.card, maxWidth:"440px", width:"100%", padding:"38px" }}>
        <div style={{ textAlign:"center", marginBottom:"30px" }}>
          <div style={{ fontSize:"40px", marginBottom:"12px" }}>📈</div>
          <h1 style={{ fontSize:"24px", fontWeight:800, color:"#f8fafc", margin:"0 0 10px", letterSpacing:"-0.04em" }}>내 투자 포트폴리오</h1>
          <p style={{ fontSize:"15px", color:"#64748b", margin:0, lineHeight:1.7 }}>동기화 키를 입력하면 어느 기기에서든<br/>같은 데이터를 사용할 수 있습니다</p>
        </div>

        <label style={{ fontSize:"14px", color:"#94a3b8", display:"block", marginBottom:"8px", fontWeight:700 }}>동기화 키</label>
        <input
          placeholder="예: kim-portfolio-2025"
          value={key}
          onChange={e => { setKey(e.target.value); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          style={{ ...S.inp, fontSize:"16px", marginBottom:"8px" }}
          autoFocus
        />
        <p style={{ fontSize:"13px", color:"#475569", margin:"0 0 16px", lineHeight:1.7 }}>
          처음이면 새로 만들어집니다. 같은 키를 다른 기기에 입력하면 데이터가 동기화됩니다.
        </p>

        {err && <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:"10px", padding:"12px 16px", fontSize:"14px", color:"#fca5a5", marginBottom:"16px", lineHeight:1.6 }}>{err}</div>}

        <button onClick={handleLogin} disabled={loading} style={{ ...S.btn(), width:"100%", padding:"14px", fontSize:"16px", opacity:loading ? 0.7 : 1 }}>
          {loading ? "연결 중..." : "시작하기 →"}
        </button>

        <div style={{ marginTop:"22px", padding:"16px", background:"rgba(99,102,241,0.09)", borderRadius:"12px", border:"1px solid rgba(99,102,241,0.2)" }}>
          <p style={{ fontSize:"14px", color:"#94a3b8", margin:0, lineHeight:1.8 }}>
            💡 <strong style={{ color:"#a5b4fc" }}>키를 꼭 기억하세요!</strong><br/>
            같은 키 → 핸드폰·PC 실시간 동기화<br/>
            다른 키 → 완전히 분리된 포트폴리오
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const saved = localStorage.getItem("pm_synckey");
  const [syncKey, setSyncKey] = useState(saved || null);
  if (!syncKey) return <LoginScreen onLogin={setSyncKey} />;
  return <PortfolioApp syncKey={syncKey} onLogout={() => { localStorage.removeItem("pm_synckey"); setSyncKey(null); }} />;
}

function PortfolioApp({ syncKey, onLogout }) {
  const [tab, setTab]           = useState("portfolio");
  const [holdings, setHoldings] = useState([]);
  const [trades, setTrades]     = useState([]);
  const [alerts, setAlerts]     = useState([]);
  const [prices, setPrices]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [toasts, setToasts]     = useState([]);
  const [loaded, setLoaded]     = useState(false);
  const [showForm, setShowForm] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const saving = useRef({});

  const [hForm, setHForm] = useState({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"" });
  const [tForm, setTForm] = useState({ date:today(), ticker:"", type:"buy", quantity:"", price:"", fee:"", note:"" });
  const [aForm, setAForm] = useState({ ticker:"", direction:"down", threshold:"" });

  // Firebase realtime listeners
  useEffect(() => {
    let unsubs = [];
    const attach = (path, setter, key) => {
      const u = dbOn(`users/${syncKey}/${path}`, val => {
        if (saving.current[key]) return;
        setter(Array.isArray(val) ? val : val ? Object.values(val) : []);
        setLoaded(true);
      });
      unsubs.push(u);
    };
    attach("holdings", setHoldings, "h");
    attach("trades",   setTrades,   "t");
    attach("alerts",   setAlerts,   "a");
    setTimeout(() => setLoaded(true), 2000);
    return () => unsubs.forEach(dbOff);
  }, [syncKey]);

  // Save helpers with debounce
  const saveData = useCallback((path, data, key) => {
    if (!loaded) return;
    saving.current[key] = true;
    dbSet(`users/${syncKey}/${path}`, data).finally(() => {
      setTimeout(() => { saving.current[key] = false; }, 500);
    });
  }, [syncKey, loaded]);

  useEffect(() => { if (loaded) saveData("holdings", holdings.length ? holdings : [], "h"); }, [holdings, loaded]);
  useEffect(() => { if (loaded) saveData("trades",   trades.length   ? trades   : [], "t"); }, [trades,   loaded]);
  useEffect(() => { if (loaded) saveData("alerts",   alerts.length   ? alerts   : [], "a"); }, [alerts,   loaded]);

  const toast = useCallback((msg, type="info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 7000);
  }, []);

  const fetchPrices = useCallback(async () => {
    if (!holdings.length) return;
    setLoading(true);
    const next = {};
    await Promise.all(holdings.map(async h => {
      let result;
      if (h.market === "CRYPTO") result = await fetchCrypto(h.ticker);
      else {
        let tk = h.ticker;
        if (h.market === "KR" && !tk.includes(".")) tk += ".KS";
        result = await fetchYahoo(tk);
      }
      if (result) next[h.ticker] = result;
    }));
    setPrices(next);
    setLastUpdated(new Date().toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit" }));
    alerts.filter(a => a.enabled).forEach(a => {
      const p = next[a.ticker]; if (!p) return;
      const chg = p.changePercent;
      if (a.direction === "up"   && chg >=  a.threshold) toast(`📈 ${a.ticker} +${chg.toFixed(2)}% 상승 알람!`, "up");
      if (a.direction === "down" && chg <= -a.threshold) toast(`📉 ${a.ticker} ${chg.toFixed(2)}% 하락 알람!`, "down");
    });
    setLoading(false);
  }, [holdings, alerts, toast]);

  useEffect(() => {
    if (!loaded || !holdings.length) return;
    fetchPrices();
    const id = setInterval(fetchPrices, 60000);
    return () => clearInterval(id);
  }, [loaded, fetchPrices]);

  const portfolio = holdings.map(h => {
    const p   = prices[h.ticker];
    const cur = p?.currency || (h.market === "KR" ? "KRW" : "USD");
    const price = p?.price ?? h.avgPrice;
    const value = price * h.quantity;
    const cost  = h.avgPrice * h.quantity;
    const pnl   = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { ...h, price, value, cost, pnl, pnlPct, cur, chgPct: p?.changePercent ?? 0, hasLive: !!p };
  });

  const totalCost = portfolio.reduce((s, h) => s + toKRW(h.cost,  h.cur), 0);
  const totalVal  = portfolio.reduce((s, h) => s + toKRW(h.value, h.cur), 0);
  const totalPnL  = totalVal - totalCost;
  const totalRet  = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const pieData = Object.entries(MARKET_LABEL).map(([k, label]) => ({
    name: label, color: MARKET_COLOR[k],
    value: Math.round(portfolio.filter(h => h.market === k).reduce((s, h) => s + toKRW(h.value, h.cur), 0)),
  })).filter(d => d.value > 0);

  const addH = () => {
    if (!hForm.ticker || !hForm.quantity || !hForm.avgPrice) return;
    setHoldings(p => [...p, { id: Date.now(), ...hForm, quantity: +hForm.quantity, avgPrice: +hForm.avgPrice }]);
    setHForm({ ticker:"", name:"", market:"KR", quantity:"", avgPrice:"" }); setShowForm(null);
  };
  const addT = () => {
    if (!tForm.ticker || !tForm.quantity || !tForm.price) return;
    setTrades(p => [...p, { id: Date.now(), ...tForm, quantity: +tForm.quantity, price: +tForm.price, fee: +(tForm.fee||0) }]);
    setTForm({ date:today(), ticker:"", type:"buy", quantity:"", price:"", fee:"", note:"" }); setShowForm(null);
  };
  const addA = () => {
    if (!aForm.ticker || !aForm.threshold) return;
    setAlerts(p => [...p, { id: Date.now(), ...aForm, threshold: +aForm.threshold, enabled: true }]);
    setAForm({ ticker:"", direction:"down", threshold:"" }); setShowForm(null);
  };

  const FONT = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif";
  const tabs = [["portfolio","📊 포트폴리오"],["trades","📝 매매일지"],["alerts","🔔 알람 설정"]];

  return (
    <div style={{ background:"linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)", color:"#e2e8f0", minHeight:"100vh", fontFamily:FONT, fontSize:"15px", lineHeight:"1.6", letterSpacing:"-0.01em" }}>

      {/* Header */}
      <div style={{ background:"rgba(15,23,42,0.88)", backdropFilter:"blur(14px)", borderBottom:"1px solid rgba(255,255,255,0.08)", padding:"14px 22px", position:"sticky", top:0, zIndex:50 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"10px" }}>
          <div>
            <div style={{ fontSize:"19px", fontWeight:800, letterSpacing:"-0.04em", color:"#f8fafc" }}>내 투자 포트폴리오</div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"3px", flexWrap:"wrap" }}>
              {lastUpdated && <span style={{ fontSize:"12px", color:"#475569" }}>마지막 업데이트: {lastUpdated}</span>}
              <span style={{ background:"rgba(99,102,241,0.2)", color:"#a5b4fc", padding:"2px 10px", borderRadius:"20px", fontSize:"12px", fontWeight:700 }}>🔑 {syncKey}</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:"8px" }}>
            <button onClick={fetchPrices} disabled={loading} style={S.btn(loading ? "#334155" : "#6366f1", { display:"flex", alignItems:"center", gap:"6px", opacity:loading?0.7:1, fontSize:"13px", padding:"8px 14px" })}>
              <span style={{ display:"inline-block", animation:loading?"spin 1s linear infinite":"none" }}>↻</span>
              {loading ? "조회 중..." : "새로고침"}
            </button>
            <button onClick={onLogout} style={S.btn("#334155", { fontSize:"13px", padding:"8px 14px" })}>로그아웃</button>
          </div>
        </div>
        <div style={{ display:"flex", gap:"4px", marginTop:"12px" }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background:tab===id?"rgba(99,102,241,0.25)":"transparent", border:tab===id?"1px solid rgba(99,102,241,0.45)":"1px solid transparent", color:tab===id?"#c7d2fe":"#64748b", padding:"7px 16px", borderRadius:"10px", cursor:"pointer", fontSize:"14px", fontWeight:tab===id?800:500, letterSpacing:"-0.01em", fontFamily:FONT }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:"22px", maxWidth:"980px", margin:"0 auto" }}>

        {/* ══ PORTFOLIO ══ */}
        {tab === "portfolio" && (<>
          {/* Summary cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"12px", marginBottom:"20px" }}>
            {[
              ["총 평가금액", Math.round(totalVal).toLocaleString("ko-KR") + "₩", "#f8fafc"],
              ["평가 손익",   (totalPnL>=0?"+":"") + Math.round(totalPnL).toLocaleString("ko-KR") + "₩", totalPnL>=0?"#34d399":"#f87171"],
              ["총 수익률",   fmtPct(totalRet), totalRet>=0?"#34d399":"#f87171"],
            ].map(([title, val, color]) => (
              <div key={title} style={{ ...S.card, background:"rgba(99,102,241,0.09)", borderColor:"rgba(99,102,241,0.22)" }}>
                <div style={{ fontSize:"12px", color:"#64748b", marginBottom:"8px", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em" }}>{title}</div>
                <div style={{ fontSize:"22px", fontWeight:800, color, letterSpacing:"-0.04em" }}>{val}</div>
              </div>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:pieData.length>0?"1fr 300px":"1fr", gap:"16px" }}>
            {/* Holdings */}
            <div style={S.card}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"16px", gap:"10px" }}>
                <div>
                  <div style={{ fontSize:"17px", fontWeight:800, letterSpacing:"-0.03em" }}>보유 종목</div>
                  <div style={{ fontSize:"12px", color:"#475569", marginTop:"5px", lineHeight:1.7 }}>KOSPI: 005930 → 자동 .KS | KOSDAQ: 035720.KQ</div>
                </div>
                <button onClick={() => setShowForm(showForm==="h"?null:"h")} style={S.btn("#6366f1", { flexShrink:0 })}>+ 종목 추가</button>
              </div>

              {showForm === "h" && (
                <div style={{ background:"rgba(0,0,0,0.35)", borderRadius:"12px", padding:"18px", marginBottom:"18px", border:"1px solid rgba(99,102,241,0.35)" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                    <input placeholder="티커 (예: 005930, AAPL, BTC)" value={hForm.ticker} onChange={e => setHForm(p => ({ ...p, ticker:e.target.value.toUpperCase() }))} style={S.inp} />
                    <input placeholder="종목명 (예: 삼성전자)" value={hForm.name} onChange={e => setHForm(p => ({ ...p, name:e.target.value }))} style={S.inp} />
                    <select value={hForm.market} onChange={e => setHForm(p => ({ ...p, market:e.target.value }))} style={{ ...S.inp, appearance:"none" }}>
                      <option value="KR">한국주식</option><option value="US">미국주식</option>
                      <option value="ETF">ETF</option><option value="CRYPTO">암호화폐</option>
                    </select>
                    <input placeholder="수량" type="number" value={hForm.quantity} onChange={e => setHForm(p => ({ ...p, quantity:e.target.value }))} style={S.inp} />
                    <input placeholder="평균 매수가 (KRW 또는 USD)" type="number" value={hForm.avgPrice} onChange={e => setHForm(p => ({ ...p, avgPrice:e.target.value }))} style={{ ...S.inp, gridColumn:"1/-1" }} />
                  </div>
                  <div style={{ display:"flex", gap:"8px", marginTop:"12px" }}>
                    <button onClick={addH} style={S.btn("#10b981")}>✓ 추가</button>
                    <button onClick={() => setShowForm(null)} style={S.btn("#475569")}>취소</button>
                  </div>
                </div>
              )}

              {portfolio.length === 0 ? (
                <div style={{ textAlign:"center", padding:"44px", color:"#475569" }}>
                  <div style={{ fontSize:"36px", marginBottom:"12px" }}>📋</div>
                  <div style={{ fontSize:"16px" }}>종목을 추가하면 실시간 시세를 조회합니다</div>
                </div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead><tr>{["종목","현재가","일변동","수량","평가금액","손익률",""].map(h => <th key={h} style={S.TH}>{h}</th>)}</tr></thead>
                    <tbody>
                      {portfolio.map(h => (
                        <tr key={h.id}>
                          <td style={S.TD}>
                            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                              <div style={{ width:"10px", height:"10px", borderRadius:"3px", background:MARKET_COLOR[h.market], flexShrink:0 }} />
                              <div>
                                <div style={{ fontWeight:800, fontSize:"15px", letterSpacing:"-0.03em" }}>{h.ticker}</div>
                                <div style={{ fontSize:"12px", color:"#475569", marginTop:"2px" }}>{h.name || MARKET_LABEL[h.market]}</div>
                              </div>
                            </div>
                          </td>
                          <td style={S.TD}>
                            <div style={{ fontWeight:700 }}>{fmtPrice(h.price, h.cur)}</div>
                            {!h.hasLive && <div style={{ fontSize:"11px", color:"#475569" }}>매수가 기준</div>}
                          </td>
                          <td style={{ ...S.TD, color:h.chgPct>=0?"#34d399":"#f87171", fontWeight:800 }}>{fmtPct(h.chgPct)}</td>
                          <td style={S.TD}>{h.quantity.toLocaleString()}</td>
                          <td style={{ ...S.TD, fontWeight:700 }}>{fmtPrice(h.value, h.cur)}</td>
                          <td style={{ ...S.TD, color:h.pnlPct>=0?"#34d399":"#f87171", fontWeight:800 }}>{fmtPct(h.pnlPct)}</td>
                          <td style={S.TD}><button onClick={() => setHoldings(p => p.filter(x => x.id !== h.id))} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:"18px" }}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize:"12px", color:"#334155", textAlign:"right", marginTop:"10px" }}>* USD 환산: 1달러 = {USD_KRW.toLocaleString()}원 기준</div>
                </div>
              )}
            </div>

            {/* Pie chart */}
            {pieData.length > 0 && (
              <div style={{ ...S.card, display:"flex", flexDirection:"column" }}>
                <div style={{ fontSize:"17px", fontWeight:800, marginBottom:"16px", letterSpacing:"-0.03em" }}>자산 배분</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={v => Math.round(v).toLocaleString("ko-KR") + "₩"} contentStyle={{ background:"#1e293b", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"10px", fontSize:"14px" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", flexDirection:"column", gap:"10px", marginTop:"12px" }}>
                  {pieData.map(d => {
                    const total = pieData.reduce((s, x) => s + x.value, 0);
                    return (
                      <div key={d.name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                          <div style={{ width:"10px", height:"10px", borderRadius:"3px", background:d.color }} />
                          <span style={{ color:"#94a3b8", fontWeight:600, fontSize:"14px" }}>{d.name}</span>
                        </div>
                        <span style={{ fontWeight:800, fontSize:"16px" }}>{((d.value / total) * 100).toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>)}

        {/* ══ TRADES ══ */}
        {tab === "trades" && (
          <div style={S.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px", flexWrap:"wrap", gap:"10px" }}>
              <div>
                <div style={{ fontSize:"17px", fontWeight:800, letterSpacing:"-0.03em" }}>매매 일지</div>
                <div style={{ fontSize:"13px", color:"#475569", marginTop:"4px" }}>총 {trades.length}건의 거래 기록</div>
              </div>
              <button onClick={() => setShowForm(showForm==="t"?null:"t")} style={S.btn()}>+ 기록 추가</button>
            </div>

            {showForm === "t" && (
              <div style={{ background:"rgba(0,0,0,0.35)", borderRadius:"12px", padding:"18px", marginBottom:"18px", border:"1px solid rgba(99,102,241,0.35)" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                  <input type="date" value={tForm.date} onChange={e => setTForm(p => ({ ...p, date:e.target.value }))} style={S.inp} />
                  <input placeholder="티커 (예: 005930, AAPL)" value={tForm.ticker} onChange={e => setTForm(p => ({ ...p, ticker:e.target.value.toUpperCase() }))} style={S.inp} />
                  <select value={tForm.type} onChange={e => setTForm(p => ({ ...p, type:e.target.value }))} style={{ ...S.inp, appearance:"none" }}>
                    <option value="buy">매수</option><option value="sell">매도</option>
                  </select>
                  <input placeholder="수량" type="number" value={tForm.quantity} onChange={e => setTForm(p => ({ ...p, quantity:e.target.value }))} style={S.inp} />
                  <input placeholder="체결가" type="number" value={tForm.price} onChange={e => setTForm(p => ({ ...p, price:e.target.value }))} style={S.inp} />
                  <input placeholder="수수료 (선택)" type="number" value={tForm.fee} onChange={e => setTForm(p => ({ ...p, fee:e.target.value }))} style={S.inp} />
                  <input placeholder="메모 (선택)" value={tForm.note} onChange={e => setTForm(p => ({ ...p, note:e.target.value }))} style={{ ...S.inp, gridColumn:"1/-1" }} />
                </div>
                <div style={{ display:"flex", gap:"8px", marginTop:"12px" }}>
                  <button onClick={addT} style={S.btn("#10b981")}>✓ 저장</button>
                  <button onClick={() => setShowForm(null)} style={S.btn("#475569")}>취소</button>
                </div>
              </div>
            )}

            {trades.length === 0 ? (
              <div style={{ textAlign:"center", padding:"44px", color:"#475569" }}>
                <div style={{ fontSize:"36px", marginBottom:"12px" }}>📝</div>
                <div style={{ fontSize:"16px" }}>매매 기록을 추가해주세요</div>
              </div>
            ) : (
              [...trades].reverse().map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 0", borderBottom:"1px solid rgba(255,255,255,0.06)", gap:"12px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"14px", minWidth:0 }}>
                    <div style={{ background:t.type==="buy"?"rgba(99,102,241,0.2)":"rgba(239,68,68,0.2)", border:`1px solid ${t.type==="buy"?"rgba(99,102,241,0.45)":"rgba(239,68,68,0.45)"}`, color:t.type==="buy"?"#c7d2fe":"#fca5a5", padding:"5px 14px", borderRadius:"20px", fontSize:"14px", fontWeight:800, flexShrink:0 }}>
                      {t.type === "buy" ? "매수" : "매도"}
                    </div>
                    <div>
                      <div style={{ fontWeight:800, fontSize:"16px", letterSpacing:"-0.03em" }}>{t.ticker} <span style={{ color:"#475569", fontWeight:500, fontSize:"13px" }}>{t.date}</span></div>
                      {t.note && <div style={{ fontSize:"14px", color:"#64748b", marginTop:"4px" }}>{t.note}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:"15px", fontWeight:700, letterSpacing:"-0.02em" }}>{t.quantity.toLocaleString()}주 × {Number(t.price).toLocaleString()}</div>
                    <div style={{ fontSize:"13px", color:"#64748b", marginTop:"3px" }}>합계 {Math.round(t.quantity*t.price).toLocaleString()} {t.fee>0?`| 수수료 ${t.fee.toLocaleString()}`:""}</div>
                  </div>
                  <button onClick={() => setTrades(p => p.filter(x => x.id !== t.id))} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:"18px", flexShrink:0 }}>✕</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ══ ALERTS ══ */}
        {tab === "alerts" && (
          <div style={S.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px", flexWrap:"wrap", gap:"10px" }}>
              <div>
                <div style={{ fontSize:"17px", fontWeight:800, letterSpacing:"-0.03em" }}>알람 설정</div>
                <div style={{ fontSize:"13px", color:"#475569", marginTop:"5px", lineHeight:1.7 }}>일일 변동폭 기준 · 60초마다 자동 체크</div>
              </div>
              <button onClick={() => setShowForm(showForm==="a"?null:"a")} style={S.btn()}>+ 알람 추가</button>
            </div>

            {showForm === "a" && (
              <div style={{ background:"rgba(0,0,0,0.35)", borderRadius:"12px", padding:"18px", margin:"16px 0", border:"1px solid rgba(99,102,241,0.35)" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
                  <input placeholder="티커 (예: 005930, AAPL, BTC)" value={aForm.ticker} onChange={e => setAForm(p => ({ ...p, ticker:e.target.value.toUpperCase() }))} style={S.inp} />
                  <select value={aForm.direction} onChange={e => setAForm(p => ({ ...p, direction:e.target.value }))} style={{ ...S.inp, appearance:"none" }}>
                    <option value="down">하락 시 알람</option>
                    <option value="up">상승 시 알람</option>
                  </select>
                  <input placeholder="기준 변동폭 % (예: 3 → ±3%)" type="number" value={aForm.threshold} onChange={e => setAForm(p => ({ ...p, threshold:e.target.value }))} style={{ ...S.inp, gridColumn:"1/-1" }} />
                </div>
                <div style={{ display:"flex", gap:"8px", marginTop:"12px" }}>
                  <button onClick={addA} style={S.btn("#10b981")}>✓ 저장</button>
                  <button onClick={() => setShowForm(null)} style={S.btn("#475569")}>취소</button>
                </div>
              </div>
            )}

            {alerts.length === 0 ? (
              <div style={{ textAlign:"center", padding:"44px", color:"#475569" }}>
                <div style={{ fontSize:"36px", marginBottom:"12px" }}>🔔</div>
                <div style={{ fontSize:"16px" }}>알람을 설정하면 기준 변동폭 초과 시 알림을 받습니다</div>
              </div>
            ) : (
              alerts.map(a => (
                <div key={a.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
                    <div style={{ fontSize:"24px" }}>{a.direction==="down"?"📉":"📈"}</div>
                    <div>
                      <div style={{ fontWeight:800, fontSize:"17px", letterSpacing:"-0.03em" }}>{a.ticker}</div>
                      <div style={{ fontSize:"14px", color:"#94a3b8", marginTop:"4px" }}>
                        {a.direction==="down"?`-${a.threshold}%`:`+${a.threshold}%`} {a.direction==="down"?"이상 하락":"이상 상승"} 시 알람
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
                    <button onClick={() => setAlerts(p => p.map(x => x.id===a.id?{...x,enabled:!x.enabled}:x))}
                      style={{ ...S.btn(a.enabled?"#10b981":"#334155"), padding:"7px 18px" }}>
                      {a.enabled ? "ON" : "OFF"}
                    </button>
                    <button onClick={() => setAlerts(p => p.filter(x => x.id !== a.id))} style={{ background:"none", border:"1px solid rgba(239,68,68,0.35)", color:"#f87171", padding:"7px 16px", borderRadius:"10px", cursor:"pointer", fontSize:"14px", fontWeight:700 }}>삭제</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Toasts */}
      <div style={{ position:"fixed", bottom:"22px", right:"22px", display:"flex", flexDirection:"column-reverse", gap:"10px", zIndex:999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background:t.type==="up"?"rgba(16,185,129,0.18)":t.type==="down"?"rgba(239,68,68,0.18)":"rgba(30,41,59,0.96)", backdropFilter:"blur(14px)", border:`1px solid ${t.type==="up"?"rgba(16,185,129,0.45)":t.type==="down"?"rgba(239,68,68,0.45)":"rgba(255,255,255,0.12)"}`, padding:"14px 20px", borderRadius:"12px", fontSize:"15px", fontWeight:700, maxWidth:"320px", letterSpacing:"-0.01em", lineHeight:1.6 }}>
            {t.msg}
          </div>
        ))}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} select option{background:#1e293b} *{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}`}</style>
    </div>
  );
}
