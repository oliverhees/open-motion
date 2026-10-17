import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as RPE } from "react";
import { evaluate, layerAt, type MotionSpec, type PatchOp, type LayerState } from "@openmotion/core";
import { Preview } from "./preview.ts";
import { fmtTime, type Comment } from "./api.ts";
import { useT } from "./i18n.ts";

type Corner = "nw" | "ne" | "sw" | "se";
interface Drag { id: string; mode: "move" | Corner; sx: number; sy: number; rect: { x: number; y: number; w: number; h: number }; moved: boolean }
export interface Draft { t: number; x: number; y: number; layer?: string }

interface Props {
  spec: MotionSpec;
  t: number;
  selected: string | null;
  mode: "select" | "comment";
  editingId: string | null;
  comments: Comment[];
  base: string;
  previewRef: MutableRefObject<Preview | null>;
  onSelect: (id: string | null) => void;
  onLive: (ops: PatchOp[]) => void;
  onCommit: () => void;
  onStartEdit: (id: string) => void;
  onComment: (draft: Draft, text: string, toAI: boolean) => void;
  onDropFiles: (files: File[], at: { x: number; y: number }) => void;
  /** Layer ids changed by the AI: they light up briefly. */
  flash?: string[];
}

export function Stage(p: Props) {
  const t_ = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [area, setArea] = useState({ w: 800, h: 450 });
  const [hover, setHover] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftAI, setDraftAI] = useState(true);
  const [draftErr, setDraftErr] = useState(false);

  const W = p.spec.canvas.width;
  const H = p.spec.canvas.height;
  const scale = Math.max(0.05, Math.min((area.w - 32) / W, (area.h - 32) / H));
  const boxW = W * scale;
  const boxH = H * scale;

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const pv = new Preview(frame.current!, p.base);
    p.previewRef.current = pv;
    void pv.load(p.spec, p.t);
    return () => { p.previewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    p.previewRef.current?.update(p.spec, p.editingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.spec]);

  const states = useMemo(() => evaluate(p.spec, p.t), [p.spec, p.t]);
  const stateOf = (id: string | null) => (id ? states.find((s) => s.id === id && s.visible && s.type !== "audio") : undefined);
  const sel = stateOf(p.selected);
  const selLayer = p.spec.layers.find((l) => l.id === p.selected);
  const hov = hover && hover !== p.selected ? stateOf(hover) : undefined;
  const animated = !!selLayer && selLayer.type !== "audio" && ["x", "y", "w", "h"].some((k) => (selLayer.keys as Record<string, unknown[]> | undefined)?.[k]?.length);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const anyLayerAt = (x: number, y: number) => {
    const vis = states.filter((s) => s.visible && s.type !== "audio");
    for (let i = vis.length - 1; i >= 0; i--) {
      const s = vis[i];
      if (x >= s.x! && x <= s.x! + s.w! && y >= s.y! && y <= s.y! + s.h!) return s.id;
    }
    return undefined;
  };

  const down = (e: RPE<HTMLDivElement>) => {
    if (p.editingId || draft) return;
    const pt = toCanvas(e);
    if (p.mode === "comment") {
      setDraft({ t: p.t, x: pt.x, y: pt.y, layer: anyLayerAt(pt.x, pt.y) });
      setDraftText("");
      setDraftErr(false);
      return;
    }
    const handle = (e.target as HTMLElement).dataset.handle as Corner | undefined;
    let id = p.selected;
    if (!handle) {
      id = layerAt(p.spec, p.t, pt.x, pt.y) ?? null;
      p.onSelect(id);
    }
    const st = stateOf(id);
    if (!id || !st) return;
    drag.current = { id, mode: handle ?? "move", sx: pt.x, sy: pt.y, rect: { x: st.x!, y: st.y!, w: st.w!, h: st.h! }, moved: false };
    overlay.current!.setPointerCapture(e.pointerId);
  };

  const move = (e: RPE<HTMLDivElement>) => {
    const pt = toCanvas(e);
    const d = drag.current;
    if (!d) {
      if (p.mode === "select" && !p.editingId) setHover(layerAt(p.spec, p.t, pt.x, pt.y) ?? null);
      return;
    }
    const dx = pt.x - d.sx;
    const dy = pt.y - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2 / scale) return;
    d.moved = true;
    const r = { ...d.rect };
    if (d.mode === "move") {
      r.x = d.rect.x + dx;
      r.y = d.rect.y + dy;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const snap = 8 / scale;
      if (Math.abs(cx - W / 2) < snap) r.x = W / 2 - r.w / 2;
      if (Math.abs(cy - H / 2) < snap) r.y = H / 2 - r.h / 2;
    } else {
      const west = d.mode === "nw" || d.mode === "sw";
      const north = d.mode === "nw" || d.mode === "ne";
      let w = Math.max(8, d.rect.w + (west ? -dx : dx));
      let h = Math.max(8, d.rect.h + (north ? -dy : dy));
      if (e.shiftKey) {
        const k = Math.max(w / d.rect.w, h / d.rect.h);
        w = d.rect.w * k;
        h = d.rect.h * k;
      }
      r.w = w;
      r.h = h;
      r.x = west ? d.rect.x + d.rect.w - w : d.rect.x;
      r.y = north ? d.rect.y + d.rect.h - h : d.rect.y;
    }
    const props = d.mode === "move" ? (["x", "y"] as const) : (["x", "y", "w", "h"] as const);
    p.onLive(props.map((prop) => ({ op: "setAt", id: d.id, prop, t: p.t, value: Math.round(r[prop] * 10) / 10 })));
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) p.onCommit();
  };

  const dbl = (e: React.MouseEvent) => {
    if (p.mode !== "select") return;
    const pt = toCanvas(e);
    const id = layerAt(p.spec, p.t, pt.x, pt.y);
    const layer = p.spec.layers.find((l) => l.id === id);
    if (layer?.type === "text") p.onStartEdit(layer.id);
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draftText.trim()) { setDraftErr(true); return; }
    p.onComment(draft, draftText.trim(), draftAI);
    setDraft(null);
  };

  const pins = p.comments
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => c.status !== "done" && Math.abs(c.t - p.t) < 1.2 && typeof c.x === "number");

  const boxStyle = (s: LayerState) => ({
    left: s.x! * scale, top: s.y! * scale, width: s.w! * scale, height: s.h! * scale,
    transform: `rotate(${s.rotation ?? 0}deg) scale(${s.scale ?? 1})`,
  });
  const layerName = (id?: string) => p.spec.layers.find((l) => l.id === id)?.name ?? id ?? t_("wholeFrame");

  return (
    <div className="stagewrap" ref={wrap} onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files); if (files.length && overlay.current) p.onDropFiles(files, toCanvas(e)); }}>
      <div className="stagebox" style={{ left: (area.w - boxW) / 2, top: (area.h - boxH) / 2, width: boxW, height: boxH }}>
        <iframe ref={frame} title="preview" allow="autoplay" sandbox="allow-scripts allow-same-origin"
          style={{ width: W, height: H, transform: `scale(${scale})` }} />
        <div ref={overlay} className={`overlay ${p.mode}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}
          onPointerLeave={() => setHover(null)} onDoubleClick={dbl} style={{ pointerEvents: p.editingId ? "none" : "auto" }}>
          {hov && <div className="hover-box" style={boxStyle(hov)} />}
          {(p.flash ?? []).map((fid) => { const st = stateOf(fid); return st ? <div key={`f-${fid}`} className="flash-box" style={boxStyle(st)} /> : null; })}
          {sel && !p.editingId && (
            <div className={`sel-box${animated ? " animated" : ""}`} style={boxStyle(sel)}>
              <span className="sel-label">{selLayer?.name ?? sel.id}{animated ? ` · ${t_("animated")}` : ""}{selLayer?.locked ? ` · ${t_("locked")}` : ""}</span>
              {!selLayer?.locked && (["nw", "ne", "sw", "se"] as const).map((c) => <span key={c} className={`h ${c}`} data-handle={c} />)}
            </div>
          )}
          {pins.map(({ c, n }) => <span key={c.id} className="pin" style={{ left: c.x! * scale, top: c.y! * scale }}>{n}</span>)}
        </div>
        {draft && (
          <div className="popover" style={{ left: Math.min(draft.x * scale, boxW - 300), top: Math.min(draft.y * scale + 8, boxH - 160) }}
            onPointerDown={(e) => e.stopPropagation()}>
            <div className="meta num">{fmtTime(draft.t)} · {layerName(draft.layer)}</div>
            <textarea autoFocus rows={3} value={draftText} placeholder={t_("commentPlaceholder")}
              onChange={(e) => { setDraftText(e.target.value); setDraftErr(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft(); if (e.key === "Escape") setDraft(null); }} />
            {draftErr && <span className="err">{t_("commentEmpty")}</span>}
            <div className="row">
              <label className="check"><input type="checkbox" checked={draftAI} onChange={(e) => setDraftAI(e.target.checked)} />{t_("sendToAI")}</label>
              <button onClick={() => setDraft(null)}>{t_("cancel")}</button>
              <button className="primary" onClick={saveDraft}>{t_("save")}</button>
            </div>
          </div>
        )}
      </div>
      <div className="hint">{p.mode === "comment" ? t_("hintComment") : t_("hintSelect")}</div>
    </div>
  );
}
