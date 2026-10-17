import { useRef, useState } from "react";
import { compToSource, findSuggestions, isWordCut, normalizeCuts, sourceToComp, wordRange, type MotionSpec, type PatchOp } from "@openmotion/core";
import { fmtTime, type Asset, type Provider } from "./api.ts";
import { useT, type Key } from "./i18n.ts";
import { IAnchor, IPlus, IRecord, IUpload } from "./icons.tsx";

export interface Upload { name: string; p: number; phase: "up" | "conv" }
export interface SttState { status: "idle" | "running" | "error"; started?: number; error?: string }

interface Props {
  spec: MotionSpec; t: number; selected: string | null; assets: Asset[]; uploads: Upload[]; stt: SttState;
  caps: { localWhisper: boolean; keys: Record<string, boolean> } | null; defaultProvider: Provider; defaultLanguage: string;
  apply: (ops: PatchOp[], key?: string) => void; seek: (t: number) => void;
  onUpload: (files: File[]) => void; onRecord: () => void; onAdd: (a: Asset, as?: "facecam" | "audio") => void;
  onTranscribe: (source: string, provider: Provider, language: string) => void;
}

const PROVIDERS: Provider[] = ["local", "openai", "elevenlabs", "groq", "deepgram"];

export function MediaTab(p: Props) {
  const t_ = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const media = p.assets.filter((a) => a.kind === "video" || a.kind === "audio");
  const [source, setSource] = useState(p.spec.transcript?.source ?? media.find((a) => a.kind === "video")?.path ?? "");
  const [provider, setProvider] = useState<Provider>(p.defaultProvider);
  const [language, setLanguage] = useState(p.defaultLanguage);
  const [mode, setMode] = useState<"play" | "anchor" | "cut">("play");
  const [pick, setPick] = useState<{ a: number; b: number } | null>(null);
  const [hideCut, setHideCut] = useState(false);
  const anchorMode = mode === "anchor";
  const [editWord, setEditWord] = useState<string | null>(null);
  const words = p.spec.transcript?.words ?? [];
  const srcNow = compToSource(p.spec, p.t);
  const anchored = new Map<string, string[]>();
  for (const l of p.spec.layers) if (l.anchor) anchored.set(l.anchor.word, [...(anchored.get(l.anchor.word) ?? []), l.name ?? l.id]);
  const selLayer = p.spec.layers.find((l) => l.id === p.selected);
  const src = source || media[0]?.path || "";
  const blocker = provider === "local" ? (p.caps && !p.caps.localWhisper ? t_("localMissing") : null)
    : p.caps && !p.caps.keys[provider] ? t_("needKey", { p: t_(`p_${provider}` as Key) }) : null;

  const tr = p.spec.transcript;
  const cuts = normalizeCuts(tr?.cuts);
  const removedTotal = cuts.reduce((a, c) => a + (c.t1 - c.t0), 0);
  const suggestions = findSuggestions(tr);

  const clickWord = (id: string, t0: number, idx: number, shift: boolean) => {
    if (tr && isWordCut(tr, id)) {
      const r = wordRange(tr, id);
      if (r) p.apply([{ op: "uncut", t0: r.t0, t1: r.t1 }]);
      return;
    }
    if (mode === "cut") {
      setPick((cur) => (shift && cur ? { a: cur.a, b: idx } : { a: idx, b: idx }));
      return;
    }
    if (anchorMode && selLayer) p.apply([{ op: "set", id: selLayer.id, path: "anchor", value: { word: id, offset: 0 } }]);
    else p.seek(sourceToComp(p.spec, t0) + 0.001);
  };

  const cutPicked = () => {
    if (!pick || !tr) return;
    const lo = Math.min(pick.a, pick.b);
    const hi = Math.max(pick.a, pick.b);
    const end = wordRange(tr, words[hi].id)!.t1;
    p.apply([{ op: "cut", t0: words[lo].t0, t1: end, reason: "manual" }]);
    setPick(null);
  };
  const inPick = (i: number) => !!pick && i >= Math.min(pick.a, pick.b) && i <= Math.max(pick.a, pick.b);

  return (
    <>
      <section className="sec">
        <div className="btnrow">
          <button onClick={p.onRecord}><span className="rec-icon"><IRecord /></span>{t_("record")}</button>
          <button onClick={() => input.current?.click()}><IUpload />{t_("upload")}</button>
          <input ref={input} type="file" multiple hidden accept="image/*,video/*,audio/*,.woff2,.woff,.ttf,.otf"
            onChange={(e) => { p.onUpload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </div>
        <div className={`dropzone ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); p.onUpload(Array.from(e.dataTransfer.files)); }}>{t_("dropHint")}</div>
        {p.uploads.map((u) => (
          <div key={u.name} style={{ display: "grid", gap: 4 }}>
            <small className="muted">{u.name}: {u.phase === "up" ? t_("uploading", { p: u.p }) : t_("converting")}</small>
            <div className="progress"><i style={{ width: `${u.phase === "up" ? u.p : 100}%` }} /></div>
          </div>
        ))}
      </section>

      <section className="sec">
        <h3>{t_("files")}</h3>
        {p.assets.filter((a) => a.kind !== "fonts").length === 0 && <p className="muted" style={{ margin: 0 }}>{t_("noFiles")}</p>}
        {p.assets.filter((a) => a.kind !== "fonts").map((a) => (
          <div key={a.path} className="asset">
            <span>{a.path.split("/").pop()}<small className="num">{t_(a.kind === "images" ? "kind_image" : a.kind === "video" ? "kind_video" : "kind_audio")}{a.duration ? ` · ${fmtTime(a.duration)}` : ""}{a.width ? ` · ${a.width}×${a.height}` : ""}</small></span>
            <span className="acts">
              <button title={t_("addToStage")} aria-label={t_("addToStage")} onClick={() => p.onAdd(a)}><IPlus /></button>
              {a.kind === "video" && <button onClick={() => p.onAdd(a, "facecam")}>{t_("asFacecam")}</button>}
            </span>
          </div>
        ))}
      </section>

      <section className="sec">
        <h3>{t_("transcript")}</h3>
        <label className="field"><span>{t_("recording")}</span>
          <select value={src} onChange={(e) => setSource(e.target.value)}>
            {media.length === 0 && <option value="">–</option>}
            {media.map((a) => <option key={a.path} value={a.path}>{a.path.split("/").pop()}</option>)}
          </select>
        </label>
        <label className="field"><span>{t_("provider")}</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {PROVIDERS.map((pr) => <option key={pr} value={pr}>{t_(`p_${pr}` as Key)}</option>)}
          </select>
        </label>
        <label className="field"><span>{t_("language")}</span><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="de / en / auto" /></label>
        {blocker && <p className="warn">{blocker}</p>}
        <button className="primary" disabled={!src || p.stt.status === "running"} onClick={() => p.onTranscribe(src, provider, language || "auto")}>
          {p.stt.status === "running" ? t_("transcribing", { s: Math.round((Date.now() - (p.stt.started ?? Date.now())) / 1000) }) : t_("transcribe")}
        </button>
        {p.stt.status === "error" && <p className="err" style={{ margin: 0 }}>{p.stt.error}</p>}
        {words.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t_("noTranscript")}</p> : (
          <>
            <div className="btnrow" style={{ alignItems: "center" }}>
              <button className={anchorMode ? "anchor-on" : ""} aria-pressed={anchorMode} onClick={() => { setMode((m) => (m === "anchor" ? "play" : "anchor")); setPick(null); }}><IAnchor />{t_("modeAnchor")}</button>
              <button className={mode === "cut" ? "cut-on" : ""} aria-pressed={mode === "cut"} onClick={() => { setMode((m) => (m === "cut" ? "play" : "cut")); setPick(null); }}>✂ {t_("modeCut")}</button>
              {mode === "cut" && <button className="primary" disabled={!pick} onClick={cutPicked}>{t_("cutSelected")}</button>}
            </div>
            <small className="muted">{anchorMode ? (selLayer ? `${t_("anchorMode")}: ${selLayer.name ?? selLayer.id}` : t_("anchorPick")) : mode === "cut" ? t_("cutHint") : ""}</small>
            <div className="btnrow" style={{ alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--muted)", fontSize: 12 }}><input type="checkbox" style={{ width: "auto" }} checked={hideCut} onChange={(e) => setHideCut(e.target.checked)} />{t_("hideCut")}</label>
              {removedTotal > 0 && <span className="num" style={{ fontSize: 12, color: "var(--danger)" }}>{t_("removed", { s: removedTotal.toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: 1 }) })}</span>}
            </div>
            <div className="words" tabIndex={0} onKeyDown={(e) => { if (mode === "cut" && pick && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); e.stopPropagation(); cutPicked(); } }}>
              {words.map((w, idx) => hideCut && tr && isWordCut(tr, w.id) ? null : editWord === w.id ? (
                <input key={w.id} autoFocus defaultValue={w.text} aria-label={t_("wordEdit")}
                  onKeyDown={(e) => { if (e.key === "Enter") { p.apply([{ op: "word", id: w.id, text: (e.target as HTMLInputElement).value }]); setEditWord(null); } if (e.key === "Escape") setEditWord(null); }}
                  onBlur={(e) => { if (e.target.value !== w.text) p.apply([{ op: "word", id: w.id, text: e.target.value }]); setEditWord(null); }} />
              ) : (
                <button key={w.id} className={`word ${srcNow >= w.t0 && srcNow < w.t1 ? "on" : ""} ${anchored.has(w.id) ? "anch" : ""} ${tr && isWordCut(tr, w.id) ? "cut" : ""} ${inPick(idx) ? "pick" : ""}`}
                  title={`${fmtTime(sourceToComp(p.spec, w.t0))}${anchored.has(w.id) ? ` · ${t_("anchor")}: ${anchored.get(w.id)!.join(", ")}` : ""} · ${t_("wordEdit")}: Doppelklick`}
                  onClick={(e) => clickWord(w.id, w.t0, idx, e.shiftKey)} onDoubleClick={() => mode !== "cut" && setEditWord(w.id)}>{w.text}</button>
              ))}
            </div>
            <div className="sec" style={{ gap: 6 }}>
              <h3>{t_("suggestions")}<span className="spacer" />
                {suggestions.length > 0 && <button style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => p.apply(suggestions.map((sg) => ({ op: "cut" as const, t0: sg.t0, t1: sg.t1, reason: sg.kind })))}>{t_("applyAll", { n: suggestions.length })}</button>}</h3>
              {suggestions.length === 0 ? <small className="muted">{t_("noSuggestions")}</small> : (
                <div className="sugg">
                  {suggestions.slice(0, 40).map((sg) => (
                    <div key={`${sg.kind}${sg.t0}`}>
                      <span className="chip">{sg.kind === "filler" ? t_("sugFiller") : t_("sugPause")}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sg.label}</span>
                      <button className="ghost num" onClick={() => p.seek(sourceToComp(p.spec, sg.t0))}>{fmtTime(sourceToComp(p.spec, sg.t0))}</button>
                      <button onClick={() => p.apply([{ op: "cut", t0: sg.t0, t1: sg.t1, reason: sg.kind }])}>{t_("applyOne")}</button>
                    </div>
                  ))}
                </div>
              )}
              <small className="muted">{t_("fillerNote")}</small>
              {cuts.length > 0 && <button className="ghost" style={{ justifySelf: "start" }} onClick={() => p.apply([{ op: "cuts", set: [] }])}>{t_("resetCuts")}</button>}
            </div>
          </>
        )}
      </section>
    </>
  );
}
