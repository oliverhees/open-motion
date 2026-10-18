// Template gallery: pick a template, see it live in the project's own look (format, style, brand),
// adjust its texts, insert it at the playhead. Everything it adds stays an ordinary, editable layer.
import { useEffect, useMemo, useRef, useState } from "react";
import { applyPatch, compile, TEMPLATES, templateDefaults, templateOps, type MotionSpec, type PatchOp, type TemplateDef } from "@openmotion/core";
import { useContext } from "react";
import { LangContext, useT } from "./i18n.ts";

interface Props {
  spec: MotionSpec;
  t: number;
  projectId: string;
  apply: (ops: PatchOp[], key?: string) => boolean | void;
  seek: (t: number) => void;
  select: (id: string | null) => void;
}

export function TemplatesTab({ spec, t, projectId, apply, seek, select }: Props) {
  const t_ = useT();
  const { lang } = useContext(LangContext);
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const tpl = TEMPLATES.find((x) => x.id === open) ?? null;
  const recording = spec.layers.some((l) => l.type === "video" && !l.scene && !l.hidden && l.duration > 4);

  const pick = (id: string) => {
    setOpen(id === open ? null : id);
    setValues(templateDefaults(spec, id));
  };
  const insert = () => {
    if (!tpl) return;
    const r = templateOps(spec, tpl.id, values, t);
    if (apply(r.ops, undefined) === false) return;
    seek(tpl.kind === "scene" && !recording ? r.at + Math.min(tpl.duration - 0.3, 2.5) : r.at + Math.min(tpl.duration - 0.3, 1.5));
    select(r.layers.find((id) => /-(title|text|q|name|word|quote|num|label)$/.test(id)) ?? r.layers[0] ?? null);
    setOpen(null);
  };

  const group = (kind: TemplateDef["kind"]) => TEMPLATES.filter((x) => x.kind === kind);
  return (
    <div className="tpl">
      <p className="muted" style={{ margin: "0 0 8px" }}>{recording ? t_("tplLeadRecording") : t_("tplLead")}</p>
      {(["scene", "overlay"] as const).map((kind) => (
        <section key={kind} className="sec">
          <h3>{t_(kind === "scene" ? "tplScenes" : "tplOverlays")}</h3>
          <div className="tpl-grid">
            {group(kind).map((x) => (
              <button key={x.id} className={`tpl-card${open === x.id ? " on" : ""}`} onClick={() => pick(x.id)} aria-expanded={open === x.id} title={x.desc[lang]}>
                <span className="tpl-ic" aria-hidden>{x.icon}</span>
                <span className="tpl-name">{x.name[lang]}</span>
              </button>
            ))}
          </div>
          {tpl && tpl.kind === kind && (
            <div className="tpl-form">
              <TemplatePreview spec={spec} tpl={tpl} values={values} projectId={projectId} />
              <p className="muted" style={{ margin: 0 }}>{tpl.desc[lang]} · {tpl.duration} s</p>
              {tpl.fields.map((f) => (
                <label key={f.key} className="tpl-field">
                  <span>{f.label[lang]}</span>
                  {f.type === "lines"
                    ? <textarea rows={Math.min(6, Math.max(3, (values[f.key] ?? "").split("\n").length))} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                    : <input value={values[f.key] ?? ""} inputMode={f.type === "number" ? "decimal" : undefined} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
                </label>
              ))}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="ghost" onClick={() => setOpen(null)}>{t_("cancel")}</button>
                <button className="primary" onClick={insert}>{t_(tpl.kind === "scene" && !recording ? "tplInsertScene" : "tplInsertHere")}</button>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** The template alone, in this project's look, looping in a small iframe scaled to the panel width. */
function TemplatePreview({ spec, tpl, values, projectId }: { spec: MotionSpec; tpl: TemplateDef; values: Record<string, string>; projectId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [debounced, setDebounced] = useState(values);
  const [k, setK] = useState(0.4);
  useEffect(() => { const h = setTimeout(() => setDebounced(values), 350); return () => clearTimeout(h); }, [values]);
  const scale = Math.min(1, 640 / spec.canvas.width);
  const iw = Math.round(spec.canvas.width * scale);
  const ih = Math.round(spec.canvas.height * scale);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Fit the panel width, but portrait formats stay at most 300 px tall.
    const ro = new ResizeObserver(() => setK(Math.min(el.clientWidth / iw, 300 / ih)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [iw, ih]);
  const html = useMemo(() => {
    try {
      // Same project look (canvas, palette, fonts, brand), empty stage: only the template.
      const base: MotionSpec = { ...spec, camera: undefined, transcript: undefined, scenes: [], layers: [] };
      const r = templateOps(base, tpl.id, debounced, 0);
      const pv = applyPatch(base, r.ops).spec;
      return compile(pv, { scale }).html.replace("<head>", `<head><base href="/projects/${projectId}/">`);
    } catch {
      return "";
    }
  }, [spec.canvas, spec.style, spec.meta, tpl, debounced, projectId, scale]);
  useEffect(() => {
    const f = frame.current;
    if (!f || !html) return;
    let timer = 0;
    let hold = 0;
    f.onload = () => {
      const om = (f.contentWindow as unknown as { __om?: { play(from?: number): void; isPlaying(): boolean } })?.__om;
      if (!om) return;
      om.play(0);
      // Loop with a short hold on the last frame, so the finished look can be read.
      timer = window.setInterval(() => { if (!om.isPlaying() && !hold) hold = window.setTimeout(() => { hold = 0; om.play(0); }, 1200); }, 300);
    };
    f.srcdoc = html;
    return () => { window.clearInterval(timer); window.clearTimeout(hold); };
  }, [html]);
  return (
    <div ref={box} className="tpl-pv" style={{ height: ih * k }}>
      <iframe ref={frame} title="preview" sandbox="allow-scripts allow-same-origin" scrolling="no" tabIndex={-1}
        style={{ width: iw, height: ih, transform: `scale(${k})`, left: `calc(50% - ${(iw * k) / 2}px)` }} />
    </div>
  );
}
