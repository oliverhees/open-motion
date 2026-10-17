import { useState, type ReactNode } from "react";
import { facecamFrame, layerTiming, sceneTimings, valueAt, type AnimProp, type FacecamLayout, type Layer, type MotionSpec, type PatchOp, type TransitionType } from "@openmotion/core";
import { fmtTime, type Asset, type Comment } from "./api.ts";
import { MediaTab } from "./MediaTab.tsx";
import type { ComponentProps } from "react";
import { useT, type Key } from "./i18n.ts";
import { IBack, IDiamond, IDown, IEye, IEyeOff, ILock, INext, ITrash, IUnlock, IUp } from "./icons.tsx";

export type Tab = "tweaks" | "layers" | "media" | "style" | "comments";
type Apply = (ops: PatchOp[], key?: string) => void;

interface Props {
  spec: MotionSpec; t: number; selected: string | null; tab: Tab; setTab: (t: Tab) => void;
  apply: Apply; seek: (t: number) => void; select: (id: string | null) => void;
  assets: Asset[]; comments: Comment[]; saveComments: (c: Comment[]) => void; currentSceneId?: string;
  media: Omit<ComponentProps<typeof MediaTab>, "spec" | "t" | "selected" | "assets" | "apply" | "seek">;
  onGenerateImage: (layerId: string, prompt: string) => void;
  imgBusy: { id: string; started: number } | null;
}

const TRANSITIONS: TransitionType[] = ["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "pop", "wipe", "blur"];
const r2 = (v: number) => Math.round(v * 100) / 100;

export function Panel(p: Props) {
  const t_ = useT();
  const open = p.comments.filter((c) => c.status !== "done").length;
  return (
    <aside className="side">
      <nav className="tabs" role="tablist">
        {(["tweaks", "layers", "media", "style", "comments"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={p.tab === k} className={p.tab === k ? "on" : ""} onClick={() => p.setTab(k)}>
            {t_(`tab${k[0].toUpperCase()}${k.slice(1)}` as Key)}{k === "comments" && open ? ` (${open})` : ""}
          </button>
        ))}
      </nav>
      <div className="tabbody">
        {p.tab === "tweaks" && <><SceneSection {...p} /><LayerSection {...p} /></>}
        {p.tab === "layers" && <LayersTab {...p} />}
        {p.tab === "media" && <MediaTab spec={p.spec} t={p.t} selected={p.selected} assets={p.assets} apply={p.apply} seek={p.seek} {...p.media} />}
        {p.tab === "style" && <StyleTab {...p} />}
        {p.tab === "comments" && <CommentsTab {...p} />}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function NumInput({ value, onChange, step = 1, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return <input type="number" className="num" value={r2(value)} step={step} min={min} max={max}
    onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />;
}

function SceneSection({ spec, currentSceneId, apply, seek }: Props) {
  const t_ = useT();
  const idx = spec.scenes.findIndex((s) => s.id === currentSceneId);
  if (idx < 0) return <section className="sec"><h3>{t_("noScenes")}</h3></section>;
  const scene = spec.scenes[idx];
  const timings = sceneTimings(spec);
  const go = (d: number) => seek(timings.get(spec.scenes[(idx + d + spec.scenes.length) % spec.scenes.length].id)!.start + 0.001);
  const texts = spec.layers.filter((l): l is Extract<Layer, { type: "text" }> => l.type === "text" && l.scene === scene.id);
  return (
    <section className="sec">
      <h3>{t_("sceneOf", { n: idx + 1, m: spec.scenes.length })}<span className="spacer" />
        <button className="ghost icon" onClick={() => go(-1)} aria-label="←"><IBack /></button>
        <button className="ghost icon" onClick={() => go(1)} aria-label="→"><INext /></button></h3>
      <Field label={t_("name")}><input value={scene.name} onChange={(e) => apply([{ op: "scene", id: scene.id, set: { name: e.target.value } }], `sn:${scene.id}`)} /></Field>
      <Field label={t_("length")}><NumInput value={scene.duration} step={0.1} min={0.1} onChange={(v) => v > 0 && apply([{ op: "scene", id: scene.id, set: { duration: v } }], `sd:${scene.id}`)} /></Field>
      <Field label={t_("speed")}>
        <div className="seg">{[0.5, 1, 2].map((v) => (
          <button key={v} className={(scene.speed ?? 1) === v ? "on" : ""} onClick={() => apply([{ op: "scene", id: scene.id, set: { speed: v } }])}>{v}×</button>
        ))}</div>
      </Field>
      {texts.length > 0 && <div className="muted">{t_("wordsOnScreen")}</div>}
      {texts.map((l) => (
        <textarea key={l.id} rows={Math.min(4, l.text.split("\n").length)} value={l.text}
          onChange={(e) => apply([{ op: "set", id: l.id, path: "text", value: e.target.value }], `text:${l.id}`)} />
      ))}
    </section>
  );
}

function AiImageField({ layerId, initial, busy, onGenerate }: { layerId: string; initial: string; busy: boolean; onGenerate: (id: string, prompt: string) => void }) {
  const t_ = useT();
  const [prompt, setPrompt] = useState(initial);
  return (
    <Field label={t_("aiImage")}>
      <div style={{ display: "grid", gap: 6 }}>
        <textarea rows={3} value={prompt} placeholder={t_("aiImagePrompt")} onChange={(e) => setPrompt(e.target.value)} />
        <button className="primary" disabled={busy || !prompt.trim()} onClick={() => onGenerate(layerId, prompt.trim())}>{busy ? t_("aiGenerating", { s: "…" }) : `🎨 ${t_("aiGenerate")}`}</button>
      </div>
    </Field>
  );
}

function LayerSection({ spec, t, selected, apply, assets, select, onGenerateImage, imgBusy }: Props) {
  const t_ = useT();
  const layer = spec.layers.find((l) => l.id === selected);
  if (!layer) return <section className="sec"><h3>{t_("noSelection")}</h3><p className="muted" style={{ margin: 0 }}>{t_("noSelectionHint")}</p></section>;
  const id = layer.id;
  const set = (path: string, value: unknown, key?: string) => apply([{ op: "set", id, path, value }], key ?? `${id}:${path}`);
  const timing = layerTiming(spec, layer);
  const palette = spec.style?.palette ?? {};

  const NumKey = ({ prop, label, step = 1 }: { prop: AnimProp; label: string; step?: number }) => {
    if (layer.type === "audio") return null;
    const keys = layer.keys?.[prop] ?? [];
    const here = keys.some((k) => Math.abs(timing.start + k.t / timing.speed - t) < 1 / spec.canvas.fps);
    const value = valueAt(spec, id, prop, t);
    return (
      <div className="numf" title={keys.length ? t_("animated") : undefined}>
        <span>{label}</span>
        <input type="number" className="num" value={r2(value)} step={step} disabled={layer.locked}
          onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) apply([{ op: "setAt", id, prop, t, value: v }], `f:${id}:${prop}`); }} />
        <button className={`kbtn ${here ? "here" : keys.length ? "anim" : ""}`} aria-label={keys.length ? t_("keyHere") : t_("keyStart")} title={keys.length ? t_("keyHere") : t_("keyStart")}
          onClick={() => apply([{ op: "setAt", id, prop, t, value, key: true }])}><IDiamond filled={here} /></button>
      </div>
    );
  };

  const swap = (kind: string) => {
    const accent = "accent" in palette ? "$accent" : "#888888";
    const img = assets.find((a) => a.kind === "images");
    const vid = assets.find((a) => a.kind === "video");
    const content: Record<string, Record<string, unknown> & { type: Layer["type"] }> = {
      text: { type: "text", text: "Text", style: { fontSize: 72, fontWeight: 700, color: "ink" in palette ? "$ink" : "#ffffff" } },
      shape: { type: "shape", shape: "rect", fill: accent, radius: 16 },
      svg: { type: "svg", viewBox: "0 0 100 100", svg: `<circle cx="50" cy="50" r="42" style="fill:${accent}"/>` },
      image: img ? { type: "image", src: img.path, fit: "cover", radius: 16 } : { type: "image", src: "" },
      video: vid ? { type: "video", src: vid.path, fit: "cover", radius: 16, muted: true } : { type: "video", src: "" },
    };
    apply([{ op: "swap", id, content: content[kind] }]);
  };

  return (
    <section className="sec">
      <h3>{t_("layer")}: {layer.name ?? id}<span className="spacer" /><small className="muted">{t_(`kind_${layer.type}` as Key)}</small>
        {!layer.locked && <button className="ghost icon" aria-label={t_("deleteLayer")} title={t_("deleteLayer")} onClick={() => { apply([{ op: "remove", id }]); select(null); }}><ITrash /></button>}</h3>
      <Field label={t_("name")}><input value={layer.name ?? ""} placeholder={id} onChange={(e) => set("name", e.target.value || null)} /></Field>
      {layer.type !== "audio" && <>
        <Field label={t_("position")}><div className="pair"><NumKey prop="x" label="X" /><NumKey prop="y" label="Y" /></div></Field>
        <Field label={t_("size")}><div className="pair"><NumKey prop="w" label="B" /><NumKey prop="h" label="H" /></div></Field>
        <Field label={t_("rotation")}><div className="pair"><NumKey prop="rotation" label="°" /><NumKey prop="opacity" label="α" step={0.05} /></div></Field>
      </>}
      <Field label={t_("timing")}>
        <div className="pair">
          <div className="numf"><span>▸</span><NumInput value={layer.start} step={0.1} min={0} onChange={(v) => v >= 0 && set("start", v)} /><span /></div>
          <div className="numf"><span>↔</span><NumInput value={layer.duration} step={0.1} min={0.1} onChange={(v) => v > 0 && set("duration", v)} /><span /></div>
        </div>
      </Field>
      {layer.anchor && (
        <Field label={t_("anchor")}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="num" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>„{spec.transcript?.words.find((w) => w.id === layer.anchor!.word)?.text ?? layer.anchor.word}" {fmtTime(timing.start)}</span>
            <div className="numf" style={{ width: 112, flexShrink: 0 }}><span>±</span><NumInput value={layer.anchor.offset ?? 0} step={0.1} onChange={(v) => set("anchor.offset", v)} /><span /></div>
            <button className="ghost" onClick={() => apply([{ op: "set", id, path: "start", value: Math.round(timing.start * 100) / 100 }, { op: "set", id, path: "scene", value: null }, { op: "set", id, path: "anchor", value: null }])}>{t_("removeAnchor")}</button>
          </div>
        </Field>
      )}
      {layer.type === "video" && (
        <Field label={t_("facecamLayout")}>
          <div className="btnrow" title={t_("layoutHint")}>
            {(["right", "corner", "circle", "split", "full"] as const).map((l) => (
              <button key={l} style={{ padding: "4px 8px", fontSize: 12 }} disabled={layer.locked} onClick={() => apply(layoutOps(spec, id, l, t))}>
                {t_(`layout${l[0].toUpperCase()}${l.slice(1)}` as Key)}</button>
            ))}
          </div>
        </Field>
      )}
      {layer.type !== "audio" && <>
        <Field label={t_("enter")}><TransitionSelect value={layer.in?.type} onChange={(v) => set("in", v ? { type: v } : null)} /></Field>
        <Field label={t_("exit")}><TransitionSelect value={layer.out?.type} onChange={(v) => set("out", v ? { type: v } : null)} /></Field>
      </>}
      {layer.type === "text" && <>
        <Field label={t_("fontSize")}><NumInput value={layer.style.fontSize} min={4} onChange={(v) => v > 0 && set("style.fontSize", v)} /></Field>
        <Field label={t_("weight")}>
          <select value={layer.style.fontWeight ?? 400} onChange={(e) => set("style.fontWeight", Number(e.target.value))}>
            {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        <Field label={t_("color")}><Swatches palette={palette} value={layer.style.color ?? "#ffffff"} onChange={(c) => set("style.color", c)} /></Field>
        <Field label={t_("align")}>
          <div className="seg">{(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={(layer.style.align ?? "left") === a ? "on" : ""} onClick={() => set("style.align", a)}>{a === "left" ? "⟸" : a === "center" ? "⟺" : "⟹"}</button>
          ))}</div>
        </Field>
      </>}
      {layer.type === "shape" && <Field label={t_("fill")}><Swatches palette={palette} value={layer.fill ?? "#888888"} onChange={(c) => set("fill", c)} /></Field>}
      {(layer.type === "image" || layer.type === "video") && <>
        <Field label={t_("source")}>
          <select value={layer.src} onChange={(e) => set("src", e.target.value)}>
            {assets.filter((a) => a.kind === (layer.type === "image" ? "images" : "video")).map((a) => <option key={a.path} value={a.path}>{a.path.split("/").pop()}</option>)}
            {!assets.some((a) => a.path === layer.src) && <option value={layer.src}>{layer.src}</option>}
          </select>
        </Field>
        <Field label={t_("fit")}>
          <select value={layer.fit ?? "cover"} onChange={(e) => set("fit", e.target.value)}>
            {["cover", "contain", "fill"].map((f) => <option key={f}>{f}</option>)}
          </select>
        </Field>
      </>}
      {(layer.type === "image" || layer.type === "svg" || layer.type === "shape") && (
        <AiImageField key={id} layerId={id} initial={layer.type === "image" ? layer.source?.prompt ?? "" : ""} busy={imgBusy?.id === id} onGenerate={onGenerateImage} />
      )}
      {layer.type === "audio" && <Field label="Volume"><NumInput value={layer.volume ?? 1} step={0.05} min={0} max={4} onChange={(v) => set("volume", v)} /></Field>}
      {layer.type === "svg" && (
        <details><summary className="muted">{t_("svgCode")}</summary>
          <textarea key={layer.svg.length} rows={6} defaultValue={layer.svg} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, marginTop: 6 }}
            onBlur={(e) => e.target.value !== layer.svg && set("svg", e.target.value)} />
        </details>
      )}
      {layer.type !== "audio" && (
        <Field label={t_("swapTo")}>
          <select value="" onChange={(e) => e.target.value && swap(e.target.value)} title={t_("swapHint")}>
            <option value="">{t_(`kind_${layer.type}` as Key)} →</option>
            {(["svg", "image", "video", "text", "shape"] as const).filter((k) => k !== layer.type).map((k) => (
              <option key={k} value={k} disabled={(k === "image" && !assets.some((a) => a.kind === "images")) || (k === "video" && !assets.some((a) => a.kind === "video"))}>{t_(`kind_${k}` as Key)}</option>
            ))}
          </select>
        </Field>
      )}
    </section>
  );
}

function TransitionSelect({ value, onChange }: { value?: string; onChange: (v: TransitionType | null) => void }) {
  const t_ = useT();
  return (
    <select value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as TransitionType | null)}>
      <option value="">{t_("none")}</option>
      {TRANSITIONS.map((tr) => <option key={tr} value={tr}>{tr}</option>)}
    </select>
  );
}

function Swatches({ palette, value, onChange }: { palette: Record<string, string>; value: string; onChange: (c: string) => void }) {
  const hex = value.startsWith("$") ? palette[value.slice(1)] ?? "#888888" : value;
  return (
    <div className="swatches">
      {Object.entries(palette).map(([name, c]) => (
        <button key={name} className={`sw ${value === `$${name}` ? "on" : ""}`} style={{ background: c }} title={`$${name}`} aria-label={name} onClick={() => onChange(`$${name}`)} />
      ))}
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#888888"} onChange={(e) => onChange(e.target.value)} aria-label="custom color" />
    </div>
  );
}

function LayersTab({ spec, selected, select, apply, seek, t }: Props) {
  const t_ = useT();
  const rows = spec.layers.map((l, i) => ({ l, i })).sort((a, b) => b.l.track - a.l.track || b.i - a.i);
  return (
    <section className="sec">
      <div className="layerlist">
        {rows.map(({ l }) => {
          const tm = layerTiming(spec, l);
          return (
            <div key={l.id} className={`lrow ${selected === l.id ? "on" : ""} ${l.hidden ? "hidden" : ""}`}
              onClick={() => { select(l.id); if (t < tm.start || t >= tm.end) seek(tm.start + 0.001); }}>
              <span className="lname"><span>{l.name ?? l.id}</span><small className="num">{t_(`kind_${l.type}` as Key)} · {fmtTime(tm.start)}–{fmtTime(tm.end)} · #{l.track}</small></span>
              <span className="acts" onClick={(e) => e.stopPropagation()}>
                <button className="ghost icon" title={l.hidden ? t_("show") : t_("hide")} aria-label={l.hidden ? t_("show") : t_("hide")} onClick={() => apply([{ op: "set", id: l.id, path: "hidden", value: l.hidden ? null : true }])}>{l.hidden ? <IEyeOff /> : <IEye />}</button>
                <button className="ghost icon" title={l.locked ? t_("unlock") : t_("lock")} aria-label={l.locked ? t_("unlock") : t_("lock")} onClick={() => apply([{ op: "set", id: l.id, path: "locked", value: l.locked ? null : true }])}>{l.locked ? <ILock /> : <IUnlock />}</button>
                <button className="ghost icon" title={t_("up")} aria-label={t_("up")} onClick={() => apply([{ op: "set", id: l.id, path: "track", value: Math.min(999, l.track + 1) }])}><IUp /></button>
                <button className="ghost icon" title={t_("down")} aria-label={t_("down")} onClick={() => apply([{ op: "set", id: l.id, path: "track", value: Math.max(0, l.track - 1) }])}><IDown /></button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StyleTab({ spec, apply }: Props) {
  const t_ = useT();
  const palette = spec.style?.palette ?? {};
  return (
    <>
      <section className="sec">
        <h3>{t_("palette")}</h3>
        {Object.entries(palette).map(([name, c]) => (
          <Field key={name} label={`$${name}`}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#888888"} onChange={(e) => apply([{ op: "style", set: { palette: { ...palette, [name]: e.target.value } } }], `pal:${name}`)} />
              <input className="num" value={c} onChange={(e) => apply([{ op: "style", set: { palette: { ...palette, [name]: e.target.value } } }], `pal:${name}`)} />
            </div>
          </Field>
        ))}
      </section>
      <section className="sec">
        <h3>{t_("background")}</h3>
        <Swatches palette={palette} value={spec.canvas.background ?? "#000000"} onChange={(c) => apply([{ op: "canvas", set: { background: c } }], "bg")} />
      </section>
      <section className="sec">
        <h3>{t_("fonts")}</h3>
        {(spec.style?.fonts ?? []).length === 0 ? <p className="muted" style={{ margin: 0 }}>{t_("noFonts")}</p>
          : spec.style!.fonts!.map((f) => <div key={f.src} style={{ fontFamily: `"${f.family}"`, fontSize: 18 }}>{f.family}</div>)}
      </section>
    </>
  );
}

function CommentsTab({ spec, comments, saveComments, seek, select }: Props) {
  const t_ = useT();
  const [, force] = useState(0);
  if (comments.length === 0) return <p className="muted">{t_("noComments")}</p>;
  const name = (id?: string) => (id ? spec.layers.find((l) => l.id === id)?.name ?? id : t_("wholeFrame"));
  const update = (id: string, patch: Partial<Comment> | null) => {
    saveComments(patch ? comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) : comments.filter((c) => c.id !== id));
    force((n) => n + 1);
  };
  return (
    <div className="clist">
      {comments.map((c, i) => (
        <div key={c.id} className={`citem ${c.status}`} onClick={() => { seek(c.t); if (c.layer) select(c.layer); }}>
          <div className="chead"><strong className="num">{i + 1}</strong><span className="num">{fmtTime(c.t)}</span><span>{name(c.layer)}</span>
            <span style={{ flex: 1 }} /><span className={`chip ${c.status}`}>{t_(c.status === "open" ? "statusOpen" : c.status === "queued" ? "statusQueued" : "statusDone")}</span></div>
          <div>{c.text}</div>
          {c.reply && <div className="reply">{t_("reply")}: {c.reply}</div>}
          <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => update(c.id, { status: c.status === "done" ? (c.toAI ? "queued" : "open") : "done" })}>{c.status === "done" ? t_("reopen") : t_("markDone")}</button>
            <button className="ghost" onClick={() => update(c.id, null)}>{t_("remove")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Facecam layout change at the playhead: hold the current frame until 0.6 s before, then glide to the new layout. */
function layoutOps(spec: MotionSpec, id: string, layout: FacecamLayout, t: number): PatchOp[] {
  const layer = spec.layers.find((l) => l.id === id);
  if (!layer || layer.type !== "video") return [];
  const target = facecamFrame(layout, spec.canvas);
  const start = layerTiming(spec, layer).start;
  const hold = t - 0.6;
  const ops: PatchOp[] = [];
  for (const prop of ["x", "y", "w", "h"] as const) {
    if (hold > start + 0.05) ops.push({ op: "setAt", id, prop, t: hold, value: Math.round(valueAt(spec, id, prop, hold) * 10) / 10, key: true });
    ops.push({ op: "setAt", id, prop, t, value: target[prop], key: true, ease: "power3.inOut" });
  }
  const radius = layout === "circle" ? 9999 : layout === "full" || layout === "split" ? 0 : 28;
  ops.push({ op: "set", id, path: "radius", value: radius });
  return ops;
}
