import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight:"100vh",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          background:"#0f172a",
          color:"#e2e8f0",
          fontFamily:"Noto Sans KR, system-ui, sans-serif",
          padding:24,
          textAlign:"center",
        }}>
          <div>
            <div style={{ fontSize:36, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>화면을 불러오는 중 오류가 발생했습니다.</div>
            <div style={{ fontSize:13, color:"#94a3b8", marginBottom:18 }}>{this.state.error?.message || "Unknown error"}</div>
            <button
              onClick={() => this.setState({ error:null })}
              style={{ background:"#6366f1", color:"#fff", border:0, borderRadius:8, padding:"10px 16px", fontWeight:700, cursor:"pointer" }}
            >
              다시 시도
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
