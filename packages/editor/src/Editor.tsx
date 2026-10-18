import { useCallback, useEffect, useRef, useState } from "react";
import { applyPatch, compositionDuration, facecamLayers, sceneTimings, valueAt, type FacecamLayout, type Layer, type MotionSpec, type PatchOp } from "@openmotion/core";
import { api, fmtTime, type AgentResult, type Asset, type ChatEntry, type Comment, type ProjectInfo, type Provider, type PublicSettings, type TranscriptResult } from "./api.ts";
import { ChatPanel } from "./ChatPanel.tsx";
import type { SttState, Upload } from "./MediaTab.tsx";
import { RecordDialog } from "./RecordDialog.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { useT } from "./i18n.ts";
import { LangSwitch, LogoutButton } from "./App.tsx";
import { Stage, type Draft } from "./Stage.tsx";
import { Preview } from "./preview.ts";
import { Panel, type Tab } from "./Panel.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { IBack, IComment, IDownload, IGear, IPause, IPlay, IRedo, IRestart, IUndo } from "./icons.tsx";

interface Entry { spec: MotionSpec; key?: string; at: number }

export function Editor({ id }: { id: string }) {
  const t_ = useT();
  const [spec, setSpec] = useState<MotionSpec | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"select" | "comment">("select");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("tweaks");
  const [save, setSave] = useState<"saved" | "saving" | "error">("saved");
  const [toast, setToast] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [dirty, setDirty] = useState(0);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [stt, setStt] = useState<SttState>({ status: "idle" });
  const [caps, setCaps] = useState<{ localWhisper: boolean; keys: Record<string, boolean> } | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [showRecord, setShowRecord] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatOpen, setChatOpen] = useState(true);
  const [aiBusy, setAiBusy] = useState<{ label: string; started: number } | null>(null);
  const [flash, setFlash] = useState<string[]>([]);
  const [imgBusy, setImgBusy] = useState<{ id: string; started: number } | null>(null);
  const snaps = useRef(new Map<string, { before: MotionSpec; after: MotionSpec }>());

  const specRef = useRef<MotionSpec | null>(null);
  specRef.current = spec;
  const hist = useRef<{ list: Entry[]; i: number }>({ list: [], i: -1 });
  const dragBase = useRef<MotionSpec | null>(null);
  const preview = useRef<Preview | null>(null);
  const lastSaved = useRef("");
  const lastRev = useRef("");
  const polling = useRef(false);
  const tRef = useRef(t_);
  tRef.current = t_;

  useEffect(() => {
    api.read(id).then((r) => {
      setSpec(r.spec);
      setProject(r.project);
      setComments(r.comments);
      hist.current = { list: [{ spec: r.spec, at: Date.now() }], i: 0 };
      lastSaved.current = JSON.stringify(r.spec);
      lastRev.current = r.project.updatedAt;
    }).catch((e: Error) => setLoadError(e.message));
    api.assets(id).then(setAssets).catch(() => setAssets([]));
    api.capabilities().then(setCaps).catch(() => setCaps(null));
    api.settings().then(setSettings).catch(() => setSettings(null));
    api.chat(id).then(setChat).catch(() => setChat([]));
  }, [id]);

  // Autosave, debounced. Never while dragging.
  useEffect(() => {
    const s = specRef.current;
    if (!s || dragBase.current) return;
    const json = JSON.stringify(s);
    if (json === lastSaved.current) return;
    setSave("saving");
    const h = setTimeout(() => {
      api.saveSpec(id, s).then((r) => { lastSaved.current = json; lastRev.current = r.updatedAt; setSave("saved"); })
        .catch((e: Error) => { setSave("error"); setToast(e.message); });
    }, 600);
    return () => clearTimeout(h);
  }, [dirty, id]);

  // Changes from outside (AI via MCP, scripts): poll the revision, load the new spec when nothing local is pending.
  useEffect(() => {
    const h = setInterval(async () => {
      const cur = specRef.current;
      if (!cur || dragBase.current || polling.current || document.hidden || JSON.stringify(cur) !== lastSaved.current) return;
      polling.current = true;
      try {
        const { updatedAt } = await api.rev(id);
        if (updatedAt === lastRev.current) return;
        const r = await api.read(id);
        const json = JSON.stringify(r.spec);
        const now = specRef.current;
        if (!now || dragBase.current || JSON.stringify(now) !== lastSaved.current) return;
        lastRev.current = r.project.updatedAt;
        if (json === lastSaved.current) return;
        const changed = r.spec.layers.filter((l) => JSON.stringify(now.layers.find((x) => x.id === l.id)) !== JSON.stringify(l)).map((l) => l.id);
        lastSaved.current = json;
        specRef.current = r.spec;
        setSpec(r.spec);
        push(r.spec);
        api.assets(id).then(setAssets).catch(() => {});
        setFlash(changed);
        setTimeout(() => setFlash([]), 2600);
        setToast(tRef.current("remoteUpdate"));
      } catch { /* offline for a moment: try again next tick */ } finally {
        polling.current = false;
      }
    }, 2000);
    return () => clearInterval(h);
  }, [id]);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(h);
  }, [toast]);

  const push = (next: MotionSpec, key?: string) => {
    const h = hist.current;
    const now = Date.now();
    const last = h.list[h.i];
    if (key && last?.key === key && now - last.at < 1500) h.list[h.i] = { spec: next, key, at: now };
    else {
      h.list = h.list.slice(0, h.i + 1);
      h.list.push({ spec: next, key, at: now });
      if (h.list.length > 150) h.list.shift();
      h.i = h.list.length - 1;
    }
    setDirty((d) => d + 1);
  };

  const apply = useCallback((ops: PatchOp[], key?: string): boolean => {
    const cur = specRef.current;
    if (!cur) return false;
    try {
      const r = applyPatch(cur, ops);
      specRef.current = r.spec;
      setSpec(r.spec);
      push(r.spec, key);
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    }
  }, []);

  const live = useCallback((ops: PatchOp[]) => {
    const base = dragBase.current ?? specRef.current;
    if (!base) return;
    dragBase.current = base;
    try {
      const r = applyPatch(base, ops);
      specRef.current = r.spec;
      setSpec(r.spec);
    } catch { /* ignore invalid intermediate states while dragging */ }
  }, []);

  const commit = useCallback(() => {
    dragBase.current = null;
    if (specRef.current) push(specRef.current);
  }, []);

  const undo = () => {
    const h = hist.current;
    if (h.i <= 0) return;
    h.i--;
    setSpec(h.list[h.i].spec);
    setDirty((d) => d + 1);
  };
  const redo = () => {
    const h = hist.current;
    if (h.i >= h.list.length - 1) return;
    h.i++;
    setSpec(h.list[h.i].spec);
    setDirty((d) => d + 1);
  };

  const duration = spec ? compositionDuration(spec) : 0;

  const seek = useCallback((nt: number) => {
    const s = specRef.current;
    if (!s) return;
    const tt = Math.max(0, Math.min(compositionDuration(s), nt));
    setPlaying(false);
    setT(tt);
    preview.current?.seek(tt);
  }, []);

  const togglePlay = () => {
    const pv = preview.current;
    if (!pv) return;
    if (playing) {
      setT(pv.pause());
      setPlaying(false);
    } else {
      setEditingId(null);
      pv.play(t >= duration - 0.02 ? 0 : t);
      setPlaying(true);
    }
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const pv = preview.current;
      if (pv) {
        setT(pv.time());
        if (!pv.isPlaying()) { setPlaying(false); return; }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const startEdit = (layerId: string) => {
    const pv = preview.current;
    if (!pv) return;
    if (playing) { setT(pv.pause()); setPlaying(false); }
    setSelected(layerId);
    setEditingId(layerId);
    const ok = pv.beginTextEdit(layerId, (text) => apply([{ op: "set", id: layerId, path: "text", value: text }], `text:${layerId}`), () => setEditingId(null));
    if (!ok) setEditingId(null);
  };

  const saveComments = (next: Comment[]) => {
    setComments(next);
    api.saveComments(id, next).catch((e: Error) => setToast(e.message));
  };
  const addComment = (d: Draft, text: string, toAI: boolean) => {
    const c: Comment = { id: `c-${Math.random().toString(16).slice(2, 10)}`, t: Math.round(d.t * 100) / 100, layer: d.layer, x: d.x, y: d.y, text, toAI, status: toAI ? "queued" : "open", createdAt: new Date().toISOString() };
    saveComments([...comments, c].sort((a, b) => a.t - b.t));
    setTab("comments");
  };


  // ---------- Media: upload, add to stage, facecam, transcription ----------
  const uniqueId = (base: string, taken: Set<string>) => {
    const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 40) || "layer";
    let cand = clean;
    for (let i = 2; taken.has(cand); i++) cand = `${clean}-${i}`;
    taken.add(cand);
    return cand;
  };

  const addAsset = (a: Asset, as?: "facecam" | "audio", at?: { x: number; y: number }, layout: FacecamLayout = "right") => {
    const s = specRef.current;
    if (!s) return;
    const taken = new Set(s.layers.map((l) => l.id));
    const top = Math.max(0, ...s.layers.map((l) => l.track));
    const name = a.path.split("/").pop()!.replace(/\.[^.]+$/, "");
    const W = s.canvas.width, H = s.canvas.height;
    if (a.kind === "video" && as === "facecam") {
      const [v, au] = facecamLayers({ id: uniqueId("facecam", taken), src: a.path, duration: a.duration ?? 10, canvas: s.canvas, layout, start: 0, track: Math.min(990, top + 10) });
      au.id = uniqueId(`${v.id}-audio`, taken);
      v.in = { type: "fade", duration: 0.5 };
      apply([{ op: "add", layer: v }, ...(a.hasAudio !== false ? [{ op: "add" as const, layer: au }] : [])]);
      setSelected(v.id);
      return;
    }
    const start = Math.round(t * 100) / 100;
    if (a.kind === "audio") {
      apply([{ op: "add", layer: { id: uniqueId(name, taken), name, type: "audio", track: Math.min(999, top + 1), start, duration: a.duration ?? 10, src: a.path, volume: 1 } }]);
      return;
    }
    if (a.kind !== "images" && a.kind !== "video") return;
    const aspect = a.width && a.height ? a.width / a.height : 16 / 9;
    let w = W * 0.4, h = w / aspect;
    if (h > H * 0.6) { h = H * 0.6; w = h * aspect; }
    const cx = at?.x ?? W / 2, cy = at?.y ?? H / 2;
    const frame = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
    const lid = uniqueId(name, taken);
    const ops: PatchOp[] = [];
    if (a.kind === "images") {
      ops.push({ op: "add", layer: { id: lid, name, type: "image", track: Math.min(999, top + 1), start, duration: 4, frame, src: a.path, fit: "cover", radius: 16, source: { kind: "upload" } } });
    } else {
      const dur = a.duration ?? 5;
      ops.push({ op: "add", layer: { id: lid, name, type: "video", track: Math.min(999, top + 1), start, duration: dur, frame, src: a.path, fit: "cover", radius: 16, muted: true, source: { kind: "upload" } } });
      if (a.hasAudio) ops.push({ op: "add", layer: { id: uniqueId(`${lid}-audio`, taken), name: `${name} (Ton)`, type: "audio", track: Math.min(999, top + 2), start, duration: dur, src: a.path, volume: 1 } as Layer });
    }
    apply(ops);
    setSelected(lid);
  };

  const uploadFiles = async (files: File[], at?: { x: number; y: number }) => {
    for (const f of files) {
      setUploads((u) => [...u, { name: f.name, p: 0, phase: "up" }]);
      try {
        const r = await api.upload(id, f, f.name, (p) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, p, phase: p >= 100 ? "conv" : "up" } : x))));
        setAssets(await api.assets(id));
        if (r.kind !== "fonts") addAsset(r, undefined, at);
      } catch (e) {
        setToast(`${f.name}: ${(e as Error).message}`);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== f.name));
      }
    }
  };

  const runTranscribe = async (source: string, provider?: Provider, language?: string) => {
    setStt({ status: "running", started: Date.now() });
    try {
      let task = await api.transcribe(id, { source, provider, language });
      while (task.status === "queued" || task.status === "running") {
        await new Promise((r) => setTimeout(r, 1000));
        task = await api.task<TranscriptResult>(task.id);
        setStt((s) => ({ ...s }));
      }
      if (task.status === "error" || !task.result) throw new Error(task.error ?? "Transkription fehlgeschlagen");
      const res = task.result as TranscriptResult;
      apply([{ op: "transcript", set: { source: res.source, provider: res.provider, ...(res.language ? { language: res.language } : {}), words: res.words } }]);
      setStt({ status: "idle" });
      setTab("media");
    } catch (e) {
      setStt({ status: "error", error: (e as Error).message });
    }
  };

  const finishRecording = async (blob: Blob, ext: string, layout: FacecamLayout, transcribe: boolean) => {
    setShowRecord(false);
    setTab("media");
    const name = `facecam-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`;
    setUploads((u) => [...u, { name, p: 0, phase: "up" }]);
    try {
      const r = await api.upload(id, blob, name, (p) => setUploads((u) => u.map((x) => (x.name === name ? { ...x, p, phase: p >= 100 ? "conv" : "up" } : x))));
      setAssets(await api.assets(id));
      addAsset(r, "facecam", undefined, layout);
      if (transcribe) void runTranscribe(r.path);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setUploads((u) => u.filter((x) => x.name !== name));
    }
  };


  // ---------- AI: chat, comments, transcript graphics, images ----------
  const addChat = (e: Omit<ChatEntry, "id" | "at"> & { id?: string }) => {
    const entry: ChatEntry = { id: e.id ?? `m-${Math.random().toString(16).slice(2, 10)}`, at: new Date().toISOString(), ...e } as ChatEntry;
    setChat((c) => {
      const next = [...c, entry];
      api.saveChat(id, next).catch(() => {});
      return next;
    });
    return entry.id;
  };

  const askAi = async (label: string, body: Record<string, unknown>): Promise<AgentResult> => {
    setAiBusy({ label, started: Date.now() });
    try {
      const task = await api.ai(id, { ...body, spec: specRef.current, selection: selected, t });
      return await api.wait(task);
    } finally {
      setAiBusy(null);
    }
  };

  const applyAi = (res: AgentResult): string | null => {
    const before = specRef.current!;
    if (res.ops.length && !apply(res.ops)) return null;
    const entryId = addChat({ role: "assistant", text: res.message, ops: res.ops.length, images: res.images, changed: res.changed });
    if (res.ops.length) {
      snaps.current.set(entryId, { before, after: specRef.current! });
      setFlash(res.changed);
      setTimeout(() => setFlash([]), 2600);
    }
    if (res.images.length) api.assets(id).then(setAssets).catch(() => {});
    return entryId;
  };

  const sendChat = async (text: string) => {
    addChat({ role: "user", text });
    const msgs = [...chat.filter((c) => c.role !== "error").map((c) => ({ role: c.role as "user" | "assistant", text: c.text })), { role: "user" as const, text }];
    try {
      applyAi(await askAi(t_("aiTitle"), { kind: "chat", messages: msgs }));
    } catch (e) {
      addChat({ role: "error", text: (e as Error).message });
    }
  };

  const fromTranscript = async () => {
    addChat({ role: "user", text: `✨ ${t_("aiFromTranscript")}` });
    try {
      applyAi(await askAi(t_("aiFromTranscript"), { kind: "transcript", maxLayers: 8 }));
    } catch (e) {
      addChat({ role: "error", text: (e as Error).message });
    }
  };

  const workComments = async () => {
    let list = comments;
    for (const c of comments.filter((x) => x.status === "queued")) {
      addChat({ role: "user", text: `💬 ${fmtTime(c.t)}: ${c.text}` });
      try {
        const res = await askAi(`💬 ${fmtTime(c.t)}`, { kind: "comment", comment: { t: c.t, layer: c.layer, text: c.text } });
        if (applyAi(res) === null) continue;
        list = list.map((x) => (x.id === c.id ? { ...x, status: "done" as const, reply: res.message } : x));
        saveComments(list);
      } catch (e) {
        addChat({ role: "error", text: (e as Error).message });
        break;
      }
    }
  };

  const undoAi = (entryId: string) => {
    const snap = snaps.current.get(entryId);
    if (!snap) return;
    if (JSON.stringify(specRef.current) !== JSON.stringify(snap.after) && !confirm(t_("aiUndoConfirm"))) return;
    specRef.current = snap.before;
    setSpec(snap.before);
    push(snap.before);
    snaps.current.delete(entryId);
    setChat((c) => {
      const next = c.map((e) => (e.id === entryId ? { ...e, undone: true } : e));
      api.saveChat(id, next).catch(() => {});
      return next;
    });
  };

  const genImage = async (layerId: string, prompt: string) => {
    const layer = specRef.current?.layers.find((l) => l.id === layerId);
    if (!layer || layer.type === "audio") return;
    setImgBusy({ id: layerId, started: Date.now() });
    try {
      const task = await api.aiImage(id, { prompt, w: layer.frame.w, h: layer.frame.h });
      const r = await api.wait(task);
      const ops: PatchOp[] = layer.type === "image"
        ? [{ op: "set", id: layerId, path: "src", value: r.path }, { op: "set", id: layerId, path: "source", value: { kind: "ai", prompt, model: `${r.provider}:${r.model}` } }]
        : [{ op: "swap", id: layerId, content: { type: "image", src: r.path, fit: "cover", source: { kind: "ai", prompt, model: `${r.provider}:${r.model}` } } }];
      apply(ops);
      setAssets(await api.assets(id));
      setFlash([layerId]);
      setTimeout(() => setFlash([]), 2600);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setImgBusy(null);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (editingId || el.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (e.key === " ") { e.preventDefault(); togglePlay(); return; }
      if (e.key === "Escape") { setSelected(null); setMode("select"); return; }
      if (e.key.toLowerCase() === "c" && !mod) { setMode((m) => (m === "comment" ? "select" : "comment")); return; }
      const s = specRef.current;
      const layer = s?.layers.find((l) => l.id === selected);
      if (!s || !layer || layer.type === "audio" || layer.locked) return;
      if (e.key === "Enter" && layer.type === "text") { e.preventDefault(); startEdit(layer.id); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); apply([{ op: "remove", id: layer.id }]); setSelected(null); return; }
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, ["x" | "y", number]> = { ArrowLeft: ["x", -step], ArrowRight: ["x", step], ArrowUp: ["y", -step], ArrowDown: ["y", step] };
      const a = arrows[e.key];
      if (a) {
        e.preventDefault();
        const value = valueAt(s, layer.id, a[0], t) + a[1];
        apply([{ op: "setAt", id: layer.id, prop: a[0], t, value }], `nudge:${layer.id}`);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (loadError) return <main className="home"><p className="err">{t_("notFound")} {loadError}</p><a href="#/">← {t_("projects")}</a></main>;
  if (!spec || !project) return <main className="home"><p className="muted">{t_("loading")}</p></main>;

  const scenes = [...sceneTimings(spec).values()];
  const currentScene = scenes.find((s) => t >= s.start && t < s.end) ?? scenes[scenes.length - 1];

  return (
    <div className={`editor ${chatOpen ? "with-chat" : ""}`}>
      <header className="top">
        <button className="ghost icon" onClick={() => (location.hash = "#/")} aria-label={t_("projects")} title={t_("projects")}><IBack /></button>
        <input className="title" value={spec.meta.title} aria-label={t_("title")}
          onChange={(e) => apply([{ op: "meta", set: { title: e.target.value } }], "title")} />
        <span className={`savestate ${save}`}>{save === "saving" ? t_("saving") : save === "saved" ? t_("saved") : t_("saveError")}</span>
        <span className="spacer" />
        {!chatOpen && <button onClick={() => setChatOpen(true)}>✦ {t_("aiOpen")}</button>}
        <button className="ghost icon" onClick={undo} title={t_("undo")} aria-label={t_("undo")}><IUndo /></button>
        <button className="ghost icon" onClick={redo} title={t_("redo")} aria-label={t_("redo")}><IRedo /></button>
        <LangSwitch />
        <LogoutButton />
        <button className="ghost icon" onClick={() => setShowSettings(true)} title={t_("settings")} aria-label={t_("settings")}><IGear /></button>
        <button className="primary" onClick={() => setShowExport(true)}><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><IDownload />{t_("export")}</span></button>
      </header>

      {chatOpen && (
        <ChatPanel entries={chat} busy={aiBusy} queued={comments.filter((c) => c.status === "queued").length}
          hasTranscript={!!spec.transcript?.words.length}
          model={settings ? `${t_(`p_${settings.ai.provider}` as "p_anthropic")} · ${settings.ai.model || ""}`.replace(/ · $/, "") : ""}
          canUndo={(eid) => snaps.current.has(eid)} onSend={(txt) => void sendChat(txt)} onTranscript={() => void fromTranscript()}
          onComments={() => void workComments()} onUndo={undoAi} onClose={() => setChatOpen(false)} />
      )}

      <Stage spec={spec} t={t} flash={flash} selected={selected} mode={mode} editingId={editingId} comments={comments}
        base={`/projects/${id}/`} previewRef={preview}
        onSelect={setSelected} onLive={live} onCommit={commit} onStartEdit={startEdit} onComment={addComment}
        onDropFiles={(files, at) => void uploadFiles(files, at)} />

      <div className="transport">
        <button className="icon" onClick={togglePlay} aria-label={playing ? t_("pause") : t_("play")} title={`${playing ? t_("pause") : t_("play")} (Space)`}>{playing ? <IPause /> : <IPlay />}</button>
        <button className="ghost icon" onClick={() => seek(0)} aria-label={t_("restart")} title={t_("restart")}><IRestart /></button>
        <span className="time">{fmtTime(t)} / {fmtTime(duration)}</span>
        <input type="range" min={0} max={duration} step={1 / spec.canvas.fps} value={t} aria-label="Zeit" onChange={(e) => seek(Number(e.target.value))} />
        <button className={`icon ${mode === "comment" ? "on" : "ghost"}`} onClick={() => setMode((m) => (m === "comment" ? "select" : "comment"))}
          aria-pressed={mode === "comment"} aria-label={t_("commentMode")} title={`${t_("commentMode")} (C)`}><IComment /></button>
      </div>

      <div className="scenes">
        {scenes.map((s) => {
          const scene = spec.scenes.find((x) => x.id === s.id)!;
          return (
            <button key={s.id} className={`scene ${currentScene?.id === s.id ? "on" : ""}`} style={{ flex: `${s.end - s.start} 1 0` }}
              onClick={() => seek(s.start + 0.001)} title={scene.name}>
              <span>{scene.name}</span><small className="num">{(s.end - s.start).toFixed(1)} s</small>
            </button>
          );
        })}
        {duration > 0 && <span className="playhead" style={{ left: `calc(10px + (100% - 20px) * ${Math.min(1, t / duration)})` }} />}
      </div>

      <Panel spec={spec} t={t} selected={selected} tab={tab} setTab={setTab} apply={apply} seek={seek} select={setSelected}
        assets={assets} comments={comments} saveComments={saveComments} currentSceneId={currentScene?.id}
        onGenerateImage={(lid, prompt) => void genImage(lid, prompt)} imgBusy={imgBusy}
        media={{ uploads, stt, caps, defaultProvider: settings?.transcription.provider ?? "local", defaultLanguage: settings?.transcription.language ?? "auto",
          onUpload: (f) => void uploadFiles(f), onRecord: () => setShowRecord(true), onAdd: (a, as) => addAsset(a, as),
          onTranscribe: (src, pr, lang) => void runTranscribe(src, pr, lang) }} />

      {toast && <div className="toast" role="alert" onClick={() => setToast(null)}>{toast}</div>}
      {showExport && <ExportDialog projectId={id} spec={spec} onClose={() => setShowExport(false)} />}
      {showRecord && <RecordDialog onClose={() => setShowRecord(false)} onDone={(b, ext, l, tr) => void finishRecording(b, ext, l, tr)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} onSaved={(s) => { setSettings(s); api.capabilities().then(setCaps).catch(() => {}); }} />}
    </div>
  );
}

