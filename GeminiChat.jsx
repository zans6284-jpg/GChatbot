import { useState, useRef, useEffect, useCallback } from "react";

// ── Models & capability map ──────────────────────────────────────────────────
const MODELS = [
  { id: "gemini-2.0-flash",               label: "Gemini 2.0 Flash",              supFreq: false },
  { id: "gemini-2.0-flash-lite",          label: "Gemini 2.0 Flash Lite",         supFreq: false },
  { id: "gemini-1.5-flash",               label: "Gemini 1.5 Flash",              supFreq: false },
  { id: "gemini-1.5-flash-8b",            label: "Gemini 1.5 Flash 8B",           supFreq: false },
  { id: "gemini-1.5-pro",                 label: "Gemini 1.5 Pro",                supFreq: false },
  { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash Preview",      supFreq: true  },
  { id: "gemini-2.5-pro-preview-06-05",   label: "Gemini 2.5 Pro Preview",        supFreq: true  },
];

const DEFAULT_SETTINGS = {
  apiKey: "", model: "gemini-2.0-flash",
  sysPrompt: "", temperature: 1.0, topK: 40, topP: 0.95,
  freqPenalty: 0.0, presPenalty: 0.0, maxTokens: 2048,
  sendHistory: true, streaming: true, showTs: true,
};

const DEFAULT_BG = { type: null, dataUrl: null, volume: 0.5, muted: false, blur: 0, dim: 45 };

function loadLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function fmtTime() {
  return new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

// ── Markdown-lite renderer ───────────────────────────────────────────────────
function renderMd(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const out = [];
  let codeBlock = [], inCode = false, codeLang = "";
  lines.forEach((line, i) => {
    if (line.startsWith("```")) {
      if (!inCode) { inCode = true; codeLang = line.slice(3); }
      else {
        out.push(<pre key={i} style={{background:"rgba(0,0,0,.45)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,padding:"10px 12px",overflowX:"auto",margin:"6px 0",fontSize:".78rem",fontFamily:"'Space Mono',monospace"}}><code>{codeBlock.join("\n")}</code></pre>);
        codeBlock = []; inCode = false;
      }
      return;
    }
    if (inCode) { codeBlock.push(line); return; }
    const inline = (s) => {
      const parts = [];
      let rest = s, k = 0;
      rest = rest.replace(/\*\*(.+?)\*\*/g, (_, m) => `%%B${m}%%`);
      rest = rest.replace(/\*(.+?)\*/g, (_, m) => `%%I${m}%%`);
      rest = rest.replace(/`(.+?)`/g, (_, m) => `%%C${m}%%`);
      rest.split(/(%%[BIC][^%]+%%)/g).forEach((seg, j) => {
        if (seg.startsWith("%%B")) parts.push(<strong key={j}>{seg.slice(3, -2)}</strong>);
        else if (seg.startsWith("%%I")) parts.push(<em key={j}>{seg.slice(3, -2)}</em>);
        else if (seg.startsWith("%%C")) parts.push(<code key={j} style={{background:"rgba(255,255,255,.1)",padding:"1px 5px",borderRadius:4,fontSize:".82em",fontFamily:"monospace"}}>{seg.slice(3, -2)}</code>);
        else parts.push(seg);
      });
      return parts;
    };
    if (/^#{1,3} /.test(line)) {
      const lvl = line.match(/^(#+)/)[1].length;
      const sz = lvl === 1 ? "1.05em" : lvl === 2 ? ".98em" : ".9em";
      out.push(<div key={i} style={{fontWeight:700,fontSize:sz,margin:"8px 0 4px"}}>{inline(line.replace(/^#+\s/,""))}</div>);
    } else if (/^[-*] /.test(line)) {
      out.push(<div key={i} style={{display:"flex",gap:6,margin:"2px 0"}}><span style={{opacity:.5,marginTop:1}}>•</span><span>{inline(line.slice(2))}</span></div>);
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\./)[1];
      out.push(<div key={i} style={{display:"flex",gap:6,margin:"2px 0"}}><span style={{opacity:.5,minWidth:16}}>{num}.</span><span>{inline(line.replace(/^\d+\.\s/,""))}</span></div>);
    } else if (line.trim() === "") {
      out.push(<div key={i} style={{height:6}} />);
    } else {
      out.push(<div key={i}>{inline(line)}</div>);
    }
  });
  return out;
}

// ── Slider ───────────────────────────────────────────────────────────────────
function Slider({ label, min, max, step, value, onChange, disabled, suffix = "", decimals = 2 }) {
  const pct = ((value - min) / (max - min) * 100).toFixed(1);
  return (
    <div style={{ marginBottom: 16, opacity: disabled ? .4 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".75rem", color: "rgba(240,240,245,.55)", marginBottom: 6, fontFamily: "'Space Mono',monospace" }}>
        <span>{label}</span>
        <span style={{ color: "#c4b5fd", fontWeight: 700 }}>{Number(value).toFixed(decimals)}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%", appearance: "none", height: 4, borderRadius: 2, outline: "none", cursor: "pointer",
          background: `linear-gradient(to right, #7c6aff 0%, #7c6aff ${pct}%, rgba(255,255,255,.15) ${pct}%, rgba(255,255,255,.15) 100%)`,
        }} />
    </div>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.07)", fontSize: ".88rem" }}>
      <span style={{ color: "rgba(240,240,245,.8)" }}>{label}</span>
      <div onClick={() => onChange(!value)} style={{
        width: 42, height: 24, borderRadius: 12, cursor: "pointer", position: "relative", flexShrink: 0,
        background: value ? "#7c6aff" : "rgba(255,255,255,.1)",
        border: `1px solid ${value ? "#7c6aff" : "rgba(255,255,255,.2)"}`,
        transition: "background .25s, border .25s",
      }}>
        <div style={{
          position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff",
          top: 2, left: value ? 20 : 2, transition: "left .25s cubic-bezier(.34,1.56,.64,1)",
        }} />
      </div>
    </div>
  );
}

// ── Section heading ──────────────────────────────────────────────────────────
function SecTitle({ children }) {
  return <div style={{ fontSize: ".7rem", letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(240,240,245,.3)", fontFamily: "'Space Mono',monospace", margin: "20px 0 10px", paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,.07)" }}>{children}</div>;
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadLS("gcs2_settings", {}) }));
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadLS("gcs2_settings", {}) }));
  const [bg, setBg] = useState(() => ({ ...DEFAULT_BG, ...loadLS("gcs2_bg_meta", {}) }));
  const [bgDataUrl, setBgDataUrl] = useState(() => loadLS("gcs2_bg_data", null));

  const [messages, setMessages] = useState([]); // {id,role,text,ts}
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]); // Gemini format

  const [showSettings, setShowSettings] = useState(false);
  const [showBg, setShowBg] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // {x,y,msgId}
  const [editTarget, setEditTarget] = useState(null); // {msgId, text}
  const [toast, setToast] = useState(null);
  const [bgPreviewUrl, setBgPreviewUrl] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const holdTimer = useRef(null);
  const toastTimer = useRef(null);
  const abortRef = useRef(null);

  const modelInfo = MODELS.find(m => m.id === settings.model) || MODELS[0];
  const draftModel = MODELS.find(m => m.id === draft.model) || MODELS[0];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // BG apply
  useEffect(() => {
    if (bg.type === "video" && videoRef.current && bgDataUrl) {
      videoRef.current.src = bgDataUrl;
      videoRef.current.volume = bg.muted ? 0 : bg.volume;
    }
  }, [bg, bgDataUrl]);

  const showToast = (msg, dur = 2500) => {
    setToast(msg); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), dur);
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!settings.apiKey) { showToast("⚠️ Masukkan API Key di ⚙️ Pengaturan!"); setShowSettings(true); return; }

    const userMsg = { id: Date.now(), role: "user", text, ts: fmtTime() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    const newHistory = settings.sendHistory
      ? [...history, { role: "user", parts: [{ text }] }]
      : [{ role: "user", parts: [{ text }] }];

    setLoading(true);

    try {
      const noFreq = !modelInfo.supFreq;
      const genConfig = {
        temperature: settings.temperature,
        topK: settings.topK,
        topP: settings.topP,
        maxOutputTokens: settings.maxTokens,
      };
      if (!noFreq && settings.freqPenalty !== 0) genConfig.frequencyPenalty = settings.freqPenalty;
      if (!noFreq && settings.presPenalty !== 0)  genConfig.presencePenalty  = settings.presPenalty;

      const body = { contents: newHistory, generationConfig: genConfig };
      if (settings.sysPrompt) body.systemInstruction = { parts: [{ text: settings.sysPrompt }] };

      const endpoint = settings.streaming ? "streamGenerateContent" : "generateContent";
      const altParam = settings.streaming ? "&alt=sse" : "";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:${endpoint}?key=${settings.apiKey}${altParam}`;

      abortRef.current = new AbortController();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      let aiText = "";
      const aiId = Date.now() + 1;

      if (settings.streaming) {
        setMessages(prev => [...prev, { id: aiId, role: "model", text: "", ts: fmtTime() }]);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json || json === "[DONE]") continue;
            try {
              const parsed = JSON.parse(json);
              const part = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              aiText += part;
              setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: aiText } : m));
            } catch {}
          }
        }
      } else {
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "(Tidak ada respons)";
        setMessages(prev => [...prev, { id: aiId, role: "model", text: aiText, ts: fmtTime() }]);
      }

      if (aiText && settings.sendHistory) {
        setHistory([...newHistory, { role: "model", parts: [{ text: aiText }] }]);
      }

    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(prev => [...prev, { id: Date.now() + 2, role: "model", text: `❌ **Error:** ${err.message}`, ts: fmtTime() }]);
      }
    }
    setLoading(false);
  };

  // ── Hold context menu ─────────────────────────────────────────────────────
  const startHold = (e, msgId) => {
    holdTimer.current = setTimeout(() => {
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      setCtxMenu({ x, y, msgId });
    }, 500);
  };
  const cancelHold = () => clearTimeout(holdTimer.current);

  const ctxCopy = () => {
    const msg = messages.find(m => m.id === ctxMenu.msgId);
    if (msg) { navigator.clipboard.writeText(msg.text).then(() => showToast("📋 Disalin!")); }
    setCtxMenu(null);
  };
  const ctxEdit = () => {
    const msg = messages.find(m => m.id === ctxMenu.msgId);
    if (msg) setEditTarget({ msgId: msg.id, text: msg.text });
    setCtxMenu(null);
  };
  const ctxDelete = () => {
    setMessages(prev => prev.filter(m => m.id !== ctxMenu.msgId));
    setCtxMenu(null); showToast("🗑️ Pesan dihapus");
  };
  const saveEdit = () => {
    setMessages(prev => prev.map(m => m.id === editTarget.msgId ? { ...m, text: editTarget.text + " ✏️" } : m));
    setEditTarget(null); showToast("✏️ Pesan diedit");
  };

  // ── BG upload ─────────────────────────────────────────────────────────────
  const handleBgFile = (file) => {
    const isVideo = file.type.startsWith("video/");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target.result;
      setBg(prev => ({ ...prev, type: isVideo ? "video" : "image" }));
      setBgPreviewUrl(url);
      setBgDataUrl(url);
      showToast("🖼️ Background diaplikasikan! Tekan 💾 Simpan.");
    };
    reader.readAsDataURL(file);
  };

  const saveBg = () => {
    const meta = { ...bg };
    saveLS("gcs2_bg_meta", meta);
    if (bgDataUrl && bgDataUrl.length < 4 * 1024 * 1024) {
      saveLS("gcs2_bg_data", bgDataUrl);
      showToast("💾 Background tersimpan!");
    } else if (bgDataUrl) {
      showToast("⚠️ File terlalu besar, hanya pengaturan disimpan.");
    } else {
      showToast("⚠️ Belum ada background.");
    }
  };
  const removeBg = () => {
    setBg({ ...DEFAULT_BG }); setBgDataUrl(null); setBgPreviewUrl(null);
    localStorage.removeItem("gcs2_bg_meta"); localStorage.removeItem("gcs2_bg_data");
    showToast("🗑️ Background dihapus");
  };

  const toggleMute = () => {
    setBg(prev => {
      const next = { ...prev, muted: !prev.muted };
      if (videoRef.current) videoRef.current.volume = next.muted ? 0 : next.volume;
      return next;
    });
    showToast(bg.muted ? "🔊 Unmuted" : "🔇 Muted");
  };

  // ── Save settings ─────────────────────────────────────────────────────────
  const saveSettings = () => {
    setSettings({ ...draft });
    saveLS("gcs2_settings", draft);
    setShowSettings(false);
    showToast("✅ Pengaturan tersimpan!");
  };

  // ── Keyboard send ─────────────────────────────────────────────────────────
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ── Drag over ─────────────────────────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);

  const effectiveBgUrl = bgDataUrl;
  const hasBg = !!effectiveBgUrl;

  // inline styles
  const S = {
    root: {
      position: "fixed", inset: 0, fontFamily: "'Syne', sans-serif",
      color: "#f0f0f5", display: "flex", flexDirection: "column",
      overflow: "hidden", fontSize: 15,
    },
    bgLayer: {
      position: "fixed", inset: 0, zIndex: 0,
      background: hasBg && bg.type === "image"
        ? `url(${effectiveBgUrl}) center/cover no-repeat`
        : "radial-gradient(ellipse at 20% 20%, #1a0a3a 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #0a1a2a 0%, transparent 60%), #0a0a0f",
    },
    bgVideo: { position: "fixed", inset: 0, zIndex: 1, width: "100%", height: "100%", objectFit: "cover", display: hasBg && bg.type === "video" ? "block" : "none" },
    bgOverlay: {
      position: "fixed", inset: 0, zIndex: 2,
      background: hasBg ? `rgba(0,0,0,${bg.dim / 100})` : "transparent",
      backdropFilter: hasBg && bg.blur > 0 ? `blur(${bg.blur}px)` : "none",
    },
    topbar: {
      position: "relative", zIndex: 10, display: "flex", alignItems: "center", gap: 10,
      padding: "12px 16px", background: "rgba(10,10,15,.88)",
      borderBottom: "1px solid rgba(255,255,255,.1)", backdropFilter: "blur(20px)", flexShrink: 0,
    },
    logo: { fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: ".95rem", background: "linear-gradient(135deg,#7c6aff,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
    badge: { fontSize: ".68rem", fontFamily: "'Space Mono',monospace", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", color: "#c4b5fd", padding: "3px 10px", borderRadius: 100, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    msgWrap: { flex: 1, overflowY: "auto", padding: "16px 14px", position: "relative", zIndex: 10 },
    inputBar: { position: "relative", zIndex: 10, padding: "10px 14px 14px", background: "rgba(10,10,15,.88)", borderTop: "1px solid rgba(255,255,255,.1)", backdropFilter: "blur(20px)", flexShrink: 0 },
    inputInner: { maxWidth: 780, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" },
    inputWrap: { flex: 1, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14 },
    textarea: { width: "100%", background: "transparent", border: "none", outline: "none", color: "#f0f0f5", fontFamily: "'Syne',sans-serif", fontSize: ".88rem", padding: "11px 14px", resize: "none", maxHeight: 130, minHeight: 42, lineHeight: 1.55, display: "block" },
    sendBtn: { width: 44, height: 44, borderRadius: 13, background: "linear-gradient(135deg,#7c6aff,#a78bfa)", border: "none", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 16px rgba(124,106,255,.4)" },
    iconBtn: { width: 36, height: 36, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(240,240,245,.6)", flexShrink: 0 },
    panel: { position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,.65)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", justifyContent: "center" },
    panelBox: { width: "100%", maxWidth: 500, background: "rgba(12,12,22,.96)", border: "1px solid rgba(255,255,255,.15)", borderRadius: "20px 20px 0 0", maxHeight: "88vh", display: "flex", flexDirection: "column" },
    panelTitle: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 10px", borderBottom: "1px solid rgba(255,255,255,.08)", fontWeight: 700, fontSize: ".95rem", flexShrink: 0 },
    panelBody: { overflowY: "auto", padding: "14px 18px 24px", flex: 1 },
    select: { width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, color: "#f0f0f5", fontFamily: "'Syne',sans-serif", fontSize: ".88rem", padding: "9px 12px", outline: "none", appearance: "none", cursor: "pointer" },
    inputField: { width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, color: "#f0f0f5", fontFamily: "'Syne',sans-serif", fontSize: ".88rem", padding: "9px 12px", outline: "none" },
    sysTA: { width: "100%", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 10, color: "#f0f0f5", fontFamily: "'Syne',sans-serif", fontSize: ".85rem", padding: "9px 12px", outline: "none", resize: "vertical", minHeight: 80, lineHeight: 1.5 },
    btnPrimary: { padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: ".85rem", background: "linear-gradient(135deg,#7c6aff,#a78bfa)", color: "#fff", boxShadow: "0 4px 14px rgba(124,106,255,.3)" },
    btnSecondary: { padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,.15)", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: ".85rem", background: "rgba(255,255,255,.06)", color: "#f0f0f5" },
    btnDanger: { padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,79,110,.35)", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: ".85rem", background: "rgba(255,79,110,.12)", color: "#ff4f6e" },
    btnSuccess: { padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(52,211,153,.35)", cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: ".85rem", background: "rgba(52,211,153,.12)", color: "#34d399" },
    label: { fontSize: ".76rem", color: "rgba(240,240,245,.5)", marginBottom: 7, fontFamily: "'Space Mono',monospace", display: "block" },
    formGroup: { marginBottom: 16 },
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        input[type=range]::-webkit-slider-thumb { appearance: none; width: 17px; height: 17px; background: #7c6aff; border-radius: 50%; cursor: pointer; box-shadow: 0 2px 8px rgba(124,106,255,.5); }
        input[type=range] { cursor: pointer; }
        @keyframes bubbleIn { from { opacity:0; transform:translateY(12px) scale(.96); } to { opacity:1; transform:none; } }
        @keyframes dot { 0%,80%,100% { transform:scale(.6); opacity:.4; } 40% { transform:scale(1.1); opacity:1; } }
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes menuIn { from { opacity:0; transform:scale(.88); } to { opacity:1; transform:scale(1); } }
        @keyframes slideUp { from { transform:translateY(100%); } to { transform:none; } }
      `}</style>

      {/* Background */}
      <div style={S.bgLayer} />
      <video ref={videoRef} style={S.bgVideo} autoPlay loop playsInline />
      <div style={S.bgOverlay} />

      {/* Topbar */}
      <div style={S.topbar}>
        <span style={S.logo}>✦ GeminiChat</span>
        <span style={S.badge}>{settings.model}</span>
        <div style={{ flex: 1 }} />
        {loading && (
          <button onClick={() => abortRef.current?.abort()} style={{ ...S.iconBtn, borderColor: "rgba(255,79,110,.4)", color: "#ff4f6e" }} title="Stop">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" strokeWidth="2" /></svg>
          </button>
        )}
        <div style={S.iconBtn} title="Hapus Chat" onClick={() => { if (confirm("Hapus semua pesan?")) { setMessages([]); setHistory([]); showToast("🗑️ Chat dikosongkan"); } }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </div>
        {hasBg && (
          <div style={S.iconBtn} title={bg.muted ? "Unmute" : "Mute"} onClick={toggleMute}>
            {bg.muted
              ? <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
              : <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a3 3 0 000 4.243" /></svg>
            }
          </div>
        )}
        <div style={S.iconBtn} title="Background" onClick={() => setShowBg(true)}>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        </div>
        <div style={S.iconBtn} title="Pengaturan" onClick={() => { setDraft({ ...settings }); setShowSettings(true); }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </div>
      </div>

      {/* Messages */}
      <div style={S.msgWrap} onClick={() => setCtxMenu(null)}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", padding: "50px 20px", opacity: .55 }}>
              <div style={{ fontSize: "2.8rem", marginBottom: 14 }}>✦</div>
              <div style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: 8 }}>Halo! Aku GeminiChat</div>
              <div style={{ fontSize: ".85rem", color: "rgba(240,240,245,.6)", lineHeight: 1.7 }}>
                Terhubung ke Gemini AI.<br />
                Buka ⚙️ Pengaturan → masukkan API Key → mulai chat!
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{ display: "flex", gap: 10, flexDirection: msg.role === "user" ? "row-reverse" : "row", animation: "bubbleIn .3s cubic-bezier(.34,1.56,.64,1)" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".7rem", fontWeight: 700, flexShrink: 0, marginTop: 4, background: msg.role === "user" ? "linear-gradient(135deg,#34d399,#059669)" : "linear-gradient(135deg,#7c6aff,#a78bfa)", color: "#fff" }}>
                {msg.role === "user" ? "U" : "✦"}
              </div>
              <div
                onMouseDown={e => startHold(e, msg.id)}
                onMouseUp={cancelHold} onMouseMove={cancelHold}
                onTouchStart={e => startHold(e, msg.id)}
                onTouchEnd={cancelHold} onTouchMove={cancelHold}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, msgId: msg.id }); }}
                style={{
                  maxWidth: "72%", padding: "11px 15px", borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  fontSize: ".88rem", lineHeight: 1.65, cursor: "pointer", userSelect: "none",
                  background: msg.role === "user" ? "linear-gradient(135deg,#7c6aff,#a78bfa)" : "rgba(255,255,255,.07)",
                  border: msg.role === "user" ? "none" : "1px solid rgba(255,255,255,.1)",
                  boxShadow: msg.role === "user" ? "0 4px 18px rgba(124,106,255,.4)" : "none",
                  color: "#f0f0f5",
                  outline: ctxMenu?.msgId === msg.id ? "2px solid #7c6aff" : "none",
                  outlineOffset: 2,
                }}>
                <div>{renderMd(msg.text)}</div>
                {settings.showTs && <div style={{ fontSize: ".62rem", color: "rgba(255,255,255,.3)", marginTop: 6, textAlign: msg.role === "user" ? "right" : "left", fontFamily: "'Space Mono',monospace" }}>{msg.ts}</div>}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#7c6aff,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".7rem", fontWeight: 700, flexShrink: 0, marginTop: 4, color: "#fff" }}>✦</div>
              <div style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "16px 16px 16px 4px", padding: "14px 18px" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {[0, 0.2, 0.4].map((d, i) => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#c4b5fd", animation: `dot 1.2s ${d}s infinite` }} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div style={S.inputBar}>
        <div style={S.inputInner}>
          <div style={S.inputWrap}>
            <textarea
              ref={inputRef}
              style={S.textarea}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ketik pesan... (Enter kirim, Shift+Enter baris baru)"
              rows={1}
            />
          </div>
          <button style={{ ...S.sendBtn, opacity: loading ? .6 : 1 }} onClick={send} disabled={loading}>
            <svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
          </button>
        </div>
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <div style={{ position: "fixed", zIndex: 9999, left: Math.min(ctxMenu.x, window.innerWidth - 175), top: Math.min(ctxMenu.y, window.innerHeight - 130), background: "rgba(12,12,22,.97)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: 6, backdropFilter: "blur(30px)", boxShadow: "0 8px 40px rgba(0,0,0,.6)", minWidth: 165, animation: "menuIn .18s cubic-bezier(.34,1.56,.64,1)" }}>
          {[
            { label: "📋  Salin", fn: ctxCopy },
            { label: "✏️  Edit", fn: ctxEdit },
            { label: "🗑️  Hapus", fn: ctxDelete, danger: true },
          ].map(item => (
            <div key={item.label} onClick={item.fn} style={{ padding: "10px 14px", borderRadius: 9, cursor: "pointer", fontSize: ".88rem", color: item.danger ? "#ff4f6e" : "#f0f0f5", display: "flex", alignItems: "center" }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.08)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEditTarget(null)}>
          <div style={{ background: "rgba(12,12,22,.97)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 20, padding: 20, width: "100%", maxWidth: 480, animation: "menuIn .25s cubic-bezier(.34,1.56,.64,1)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: ".95rem", marginBottom: 12, color: "#c4b5fd" }}>✏️ Edit Pesan</div>
            <textarea style={{ ...S.sysTA, minHeight: 100 }} value={editTarget.text} onChange={e => setEditTarget(prev => ({ ...prev, text: e.target.value }))} />
            <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
              <button style={S.btnSecondary} onClick={() => setEditTarget(null)}>Batal</button>
              <button style={S.btnPrimary} onClick={saveEdit}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div style={S.panel} onClick={() => setShowSettings(false)}>
          <div style={{ ...S.panelBox, animation: "slideUp .3s cubic-bezier(.34,1.2,.64,1)" }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: "rgba(255,255,255,.15)", borderRadius: 2, margin: "12px auto 0" }} />
            <div style={S.panelTitle}>
              ⚙️ Pengaturan AI
              <button onClick={() => setShowSettings(false)} style={{ ...S.btnSecondary, padding: "4px 10px", fontSize: ".8rem" }}>✕</button>
            </div>
            <div style={S.panelBody}>
              <SecTitle>API & Model</SecTitle>
              <div style={S.formGroup}>
                <label style={S.label}>API Key Gemini</label>
                <input type="password" style={S.inputField} value={draft.apiKey} onChange={e => setDraft(p => ({ ...p, apiKey: e.target.value }))} placeholder="AIza..." autoComplete="off" />
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Model</label>
                <select style={S.select} value={draft.model} onChange={e => setDraft(p => ({ ...p, model: e.target.value }))}>
                  {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              {!draftModel.supFreq && (
                <div style={{ padding: "8px 12px", background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)", borderRadius: 8, fontSize: ".76rem", color: "#fbbf24", marginBottom: 12 }}>
                  ⚠️ Model ini tidak mendukung Frequency/Presence Penalty — dinonaktifkan otomatis.
                </div>
              )}

              <SecTitle>System Prompt</SecTitle>
              <div style={S.formGroup}>
                <textarea style={S.sysTA} value={draft.sysPrompt} onChange={e => setDraft(p => ({ ...p, sysPrompt: e.target.value }))} placeholder="Tulis instruksi sistem di sini...&#10;Contoh: Kamu adalah asisten ramah yang menjawab dalam bahasa Indonesia." />
              </div>

              <SecTitle>Parameter Generasi</SecTitle>
              <Slider label="Temperature" min={0} max={2} step={0.05} value={draft.temperature} onChange={v => setDraft(p => ({ ...p, temperature: v }))} decimals={2} />
              <Slider label="Top-K" min={1} max={100} step={1} value={draft.topK} onChange={v => setDraft(p => ({ ...p, topK: v }))} decimals={0} />
              <Slider label="Top-P" min={0} max={1} step={0.01} value={draft.topP} onChange={v => setDraft(p => ({ ...p, topP: v }))} decimals={2} />
              <Slider label="Frequency Penalty" min={-2} max={2} step={0.05} value={draft.freqPenalty} onChange={v => setDraft(p => ({ ...p, freqPenalty: v }))} decimals={2} disabled={!draftModel.supFreq} />
              <Slider label="Presence Penalty" min={-2} max={2} step={0.05} value={draft.presPenalty} onChange={v => setDraft(p => ({ ...p, presPenalty: v }))} decimals={2} disabled={!draftModel.supFreq} />
              <Slider label="Max Output Tokens" min={128} max={8192} step={128} value={draft.maxTokens} onChange={v => setDraft(p => ({ ...p, maxTokens: v }))} decimals={0} />

              <SecTitle>Opsi Chat</SecTitle>
              <Toggle label="Kirim riwayat percakapan" value={draft.sendHistory} onChange={v => setDraft(p => ({ ...p, sendHistory: v }))} />
              <Toggle label="Streaming respons" value={draft.streaming} onChange={v => setDraft(p => ({ ...p, streaming: v }))} />
              <Toggle label="Tampilkan timestamp" value={draft.showTs} onChange={v => setDraft(p => ({ ...p, showTs: v }))} />

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button style={{ ...S.btnPrimary, flex: 1 }} onClick={saveSettings}>💾 Simpan</button>
                <button style={S.btnSecondary} onClick={() => { setDraft({ ...DEFAULT_SETTINGS }); showToast("↺ Draft direset"); }}>↺ Reset</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Background Panel ── */}
      {showBg && (
        <div style={S.panel} onClick={() => setShowBg(false)}>
          <div style={{ ...S.panelBox, animation: "slideUp .3s cubic-bezier(.34,1.2,.64,1)" }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 40, height: 4, background: "rgba(255,255,255,.15)", borderRadius: 2, margin: "12px auto 0" }} />
            <div style={S.panelTitle}>
              🖼️ Background
              <button onClick={() => setShowBg(false)} style={{ ...S.btnSecondary, padding: "4px 10px", fontSize: ".8rem" }}>✕</button>
            </div>
            <div style={S.panelBody}>
              {/* Preview */}
              <div style={{ width: "100%", height: 120, borderRadius: 12, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", overflow: "hidden", position: "relative", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,240,245,.3)", fontSize: ".85rem" }}>
                {bgPreviewUrl || effectiveBgUrl ? (
                  bg.type === "image"
                    ? <img src={bgPreviewUrl || effectiveBgUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <video src={bgPreviewUrl || effectiveBgUrl} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : "Belum ada background"}
              </div>

              {/* Upload zone */}
              <div
                style={{ border: `2px dashed ${dragOver ? "#7c6aff" : "rgba(255,255,255,.18)"}`, borderRadius: 12, padding: "20px 16px", textAlign: "center", cursor: "pointer", marginBottom: 14, color: dragOver ? "#c4b5fd" : "rgba(240,240,245,.5)", fontSize: ".85rem", transition: "all .2s" }}
                onClick={() => document.getElementById("bg-file-upload").click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleBgFile(f); }}>
                <div style={{ fontSize: "1.6rem", marginBottom: 6 }}>📁</div>
                Klik atau seret foto / video ke sini<br />
                <small style={{ color: "rgba(240,240,245,.3)" }}>JPG, PNG, GIF, MP4, WebM, MOV</small>
              </div>
              <input type="file" id="bg-file-upload" accept="image/*,video/*" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleBgFile(e.target.files[0]); e.target.value = ""; }} />

              <SecTitle>Audio</SecTitle>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                <button style={{ ...S.iconBtn, flexShrink: 0 }} onClick={toggleMute}>
                  {bg.muted
                    ? <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                    : <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a3 3 0 000 4.243" /></svg>
                  }
                </button>
                <Slider label="" min={0} max={1} step={0.05} value={bg.volume} onChange={v => { setBg(p => ({ ...p, volume: v })); if (videoRef.current && !bg.muted) videoRef.current.volume = v; }} decimals={0} suffix="%" />
                <span style={{ fontSize: ".78rem", color: "rgba(240,240,245,.4)", minWidth: 32, textAlign: "right", fontFamily: "'Space Mono',monospace" }}>{Math.round(bg.volume * 100)}%</span>
              </div>

              <SecTitle>Overlay</SecTitle>
              <Slider label="Blur" min={0} max={20} step={1} value={bg.blur} onChange={v => setBg(p => ({ ...p, blur: v }))} decimals={0} suffix="px" />
              <Slider label="Kegelapan" min={0} max={90} step={5} value={bg.dim} onChange={v => setBg(p => ({ ...p, dim: v }))} decimals={0} suffix="%" />

              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                <button style={{ ...S.btnSuccess, flex: 1 }} onClick={saveBg}>💾 Simpan Background</button>
                <button style={S.btnDanger} onClick={removeBg}>🗑️ Hapus</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 86, left: "50%", zIndex: 9999, pointerEvents: "none", background: "rgba(12,12,22,.97)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 100, padding: "8px 18px", fontSize: ".82rem", color: "rgba(240,240,245,.8)", whiteSpace: "nowrap", backdropFilter: "blur(20px)", boxShadow: "0 4px 20px rgba(0,0,0,.4)", animation: "toastIn .3s ease" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
