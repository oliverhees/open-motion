// Brand kits: logo, colors, fonts, tagline/website/handle and an optional logo bug.
// Left the list, right the brand being edited with a live preview card (same palette math as the server).
import { useEffect, useMemo, useRef, useState } from "react";
import { brandPalette, STYLES, type Brand, type BrandColors, type Corner } from "@openmotion/core";
import { api, type BrandInput } from "./api.ts";
import { useT } from "./i18n.ts";

const COLOR_KEYS = ["accent", "accent2", "bg", "ink", "surface", "muted"] as const;
const FONT_SUGGESTIONS = [...new Set(STYLES.flatMap((s) => [s.fonts.display, s.fonts.body]).concat(["Inter", "Montserrat", "Poppins", "Roboto", "Open Sans", "Lato", "Playfair Display", "DM Sans", "Bebas Neue", "Oswald"]))].sort();

const loadedFonts = new Set<string>();
function useFont(name: string | undefined, url: string | undefined) {
  useEffect(() => {
    if (!name || !url || loadedFonts.has(url)) return;
    loadedFonts.add(url);
    new FontFace(name, `url(${url})`).load().then((f) => document.fonts.add(f)).catch(() => loadedFonts.delete(url));
  }, [name, url]);
}

export function BrandsDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const t_ = useT();
  const [list, setList] = useState<Brand[] | null>(null);
  const [def, setDef] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrandInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const logoIn = useRef<HTMLInputElement>(null);
  const fontIn = useRef<HTMLInputElement>(null);
  const fontSlot = useRef<"display" | "body">("display");

  const reload = async (keep?: string) => {
    const r = await api.brands();
    setList(r.brands);
    setDef(r.default);
    const id = keep ?? sel ?? r.brands[0]?.id ?? null;
    setSel(id);
    const b = r.brands.find((x) => x.id === id);
    setDraft(b ? toDraft(b) : null);
    onChanged?.();
  };
  useEffect(() => { reload().catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const brand = list?.find((b) => b.id === sel) ?? null;
  const dirty = !!brand && !!draft && JSON.stringify(toDraft(brand)) !== JSON.stringify(draft);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const create = () => run(async () => {
    const b = await api.createBrand({ name: t_("brandNew"), colors: { accent: "#FF5A1F" } });
    if (!list?.length) await api.saveSettings({ brand: b.id });
    await reload(b.id);
    // Straight into naming the new brand.
    setTimeout(() => { const el = document.getElementById("br-name") as HTMLInputElement | null; el?.focus(); el?.select(); }, 50);
  });
  const save = () => run(async () => { if (sel && draft) { await api.updateBrand(sel, draft); await reload(sel); setSavedAt(Date.now()); } });
  const remove = () => run(async () => {
    if (!sel || !confirm(t_("brandDeleteConfirm", { name: brand?.name ?? "" }))) return;
    await api.deleteBrand(sel);
    setSel(null);
    await reload("");
  });
  const upload = (file: File, kind: "logo" | "font") => run(async () => {
    if (!sel) return;
    if (dirty && draft) await api.updateBrand(sel, draft);
    if (kind === "logo") await api.brandLogo(sel, file);
    else await api.brandFont(sel, fontSlot.current, file, draft?.fonts?.[fontSlot.current]?.family || file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "));
    await reload(sel);
  });
  const setDefault = (on: boolean) => run(async () => { await api.saveSettings({ brand: on ? sel : null }); await reload(sel ?? undefined); });

  const setColor = (k: keyof BrandColors, v: string | null) => setDraft((d) => d && ({ ...d, colors: { ...(d.colors as BrandColors), [k]: v ?? "" } }));
  const setFont = (slot: "display" | "body", family: string) => setDraft((d) => d && ({ ...d, fonts: { ...d.fonts, [slot]: family ? { ...(d.fonts?.[slot] ?? {}), family } : null } as BrandInput["fonts"] }));
  const setWeight = (slot: "display" | "body", weight: number) => setDraft((d) => d && d.fonts?.[slot] ? ({ ...d, fonts: { ...d.fonts, [slot]: { ...d.fonts[slot]!, weight } } }) : d);

  // Live preview: the palette exactly as a project will get it.
  const pal = useMemo(() => brandPalette(cleanColors(draft?.colors)), [draft?.colors]);
  const dFam = draft?.fonts?.display?.family;
  const bFam = draft?.fonts?.body?.family || dFam;
  const dUrl = brand && dFam ? (brand.fonts.display?.file && brand.fonts.display.family === dFam ? api.brandFontUrl(brand, "display") : api.fontUrl(dFam)) : undefined;
  const bUrl = brand && bFam ? (brand.fonts.body?.file && brand.fonts.body.family === bFam ? api.brandFontUrl(brand, "body") : api.fontUrl(bFam)) : undefined;
  useFont(dFam ? `om-br-${dFam}` : undefined, dUrl);
  useFont(bFam ? `om-br-${bFam}` : undefined, bUrl);
  const wm = draft?.watermark ?? null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal brands" role="dialog" aria-modal="true" aria-labelledby="br-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="br-title">🎨 {t_("brands")}</h2>
        <p className="muted" style={{ margin: 0 }}>{t_("brandsLead")}</p>
        <div className="br-grid">
          <div className="br-list">
            {list?.map((b) => (
              <button key={b.id} className={`br-item${b.id === sel ? " on" : ""}`} onClick={() => { setSel(b.id); setDraft(toDraft(b)); }}>
                {b.logo ? <img src={api.brandLogoUrl(b)} alt="" /> : <i style={{ background: b.colors.accent }} />}
                <span>{b.name}</span>
                {b.id === def && <small className="chip">{t_("brandDefault")}</small>}
              </button>
            ))}
            <button className="br-add" onClick={create} disabled={busy}>＋ {t_("brandAdd")}</button>
          </div>
          {!brand || !draft ? (
            <div className="br-empty muted">{list && list.length === 0 ? t_("brandEmpty") : ""}</div>
          ) : (
            <div className="br-form">
              <div className="br-preview" style={{ background: pal.bg, color: pal.ink }}>
                {brand.logo ? <img src={api.brandLogoUrl(brand)} alt="" className="br-pv-logo" /> : <span className="br-pv-logo ph">{t_("brandNoLogo")}</span>}
                <strong style={{ fontFamily: dFam ? `"om-br-${dFam}", system-ui` : undefined, fontWeight: draft.fonts?.display?.weight ?? 800 }}>{draft.tagline || draft.name}</strong>
                <span style={{ fontFamily: bFam ? `"om-br-${bFam}", system-ui` : undefined, color: pal.muted, fontWeight: draft.fonts?.body?.weight ?? 400 }}>{t_("brandSample")}</span>
                <span className="br-pv-row">
                  <em style={{ background: pal.accent, color: pal.bg }}>{draft.handle || draft.website || "Call to action"}</em>
                  {pal.accent2 && <em style={{ background: pal.accent2, color: pal.bg }}>2</em>}
                  <em style={{ background: pal.surface, color: pal.ink }}>{t_("brandCard")}</em>
                </span>
              </div>

              <label className="field"><span>{t_("brandName")}</span><input id="br-name" value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <div className="field"><span>{t_("brandLogo")}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => logoIn.current?.click()} disabled={busy}>{brand.logo ? t_("brandLogoChange") : t_("brandLogoUpload")}</button>
                </span>
              </div>
              <input ref={logoIn} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f, "logo"); }} />

              <h3 className="br-h">{t_("brandColors")}</h3>
              <div className="br-colors">
                {COLOR_KEYS.map((k) => {
                  const v = draft.colors?.[k] ?? "";
                  const auto = !v && k !== "accent";
                  return (
                    <label key={k} className="br-color" title={t_(`bc_${k}_hint` as "bc_accent_hint")}>
                      <input type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : pal[k] ?? "#888888"} onChange={(e) => setColor(k, e.target.value)} aria-label={t_(`bc_${k}` as "bc_accent")} />
                      <span>{t_(`bc_${k}` as "bc_accent")}{auto && <small className="muted"> · {t_("brandAuto")}</small>}</span>
                      {!auto && k !== "accent" && <button className="ghost xs" onClick={(e) => { e.preventDefault(); setColor(k, null); }} aria-label={t_("brandAuto")}>✕</button>}
                    </label>
                  );
                })}
              </div>

              <h3 className="br-h">{t_("brandFonts")}</h3>
              <datalist id="br-fonts">{FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
              {(["display", "body"] as const).map((slot) => (
                <div key={slot} className="field br-font">
                  <span>{t_(slot === "display" ? "brandFontDisplay" : "brandFontBody")}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input list="br-fonts" placeholder="Google Font" value={draft.fonts?.[slot]?.family ?? ""} onChange={(e) => setFont(slot, e.target.value)} style={{ width: 190 }} />
                    <select style={{ width: 96 }} value={draft.fonts?.[slot]?.weight ?? ""} onChange={(e) => setWeight(slot, Number(e.target.value))} disabled={!draft.fonts?.[slot]} aria-label={t_("brandWeight")}>
                      <option value="">{t_("brandWeight")}</option>
                      {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                    <button className="ghost" title={t_("brandFontUpload")} onClick={() => { fontSlot.current = slot; fontIn.current?.click(); }} disabled={busy}>⤒</button>
                    {brand.fonts[slot]?.file && brand.fonts[slot]?.family === draft.fonts?.[slot]?.family && <small className="chip">{t_("brandOwnFont")}</small>}
                  </span>
                </div>
              ))}
              <input ref={fontIn} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f, "font"); }} />

              <h3 className="br-h">{t_("brandTexts")}</h3>
              <label className="field"><span>{t_("brandTagline")}</span><input value={draft.tagline ?? ""} placeholder={t_("brandTaglinePh")} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} /></label>
              <label className="field"><span>{t_("brandWebsite")}</span><input value={draft.website ?? ""} placeholder="example.com" onChange={(e) => setDraft({ ...draft, website: e.target.value })} /></label>
              <label className="field"><span>{t_("brandHandle")}</span><input value={draft.handle ?? ""} placeholder="@name" onChange={(e) => setDraft({ ...draft, handle: e.target.value })} /></label>

              <h3 className="br-h">{t_("brandBug")}</h3>
              <div className="field"><span>{t_("brandBugCorner")}</span>
                <div className="seg" role="radiogroup" aria-label={t_("brandBugCorner")} style={{ minWidth: 230 }}>
                  {([[null, t_("off")], ["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]] as [Corner | null, string][]).map(([c, label]) => (
                    <button key={String(c)} role="radio" aria-checked={(wm?.corner ?? null) === c} className={(wm?.corner ?? null) === c ? "on" : ""}
                      onClick={() => setDraft({ ...draft, watermark: c ? { corner: c, opacity: wm?.opacity ?? 0.85, size: wm?.size ?? 0.07 } : null })} disabled={!!c && !brand.logo} title={!brand.logo && c ? t_("brandBugNeedsLogo") : undefined}>{label}</button>
                  ))}
                </div>
              </div>
              {wm && <>
                <label className="field"><span>{t_("brandBugSize")} {Math.round((wm.size ?? 0.07) * 100)} %</span><input type="range" min={3} max={20} value={Math.round((wm.size ?? 0.07) * 100)} onChange={(e) => setDraft({ ...draft, watermark: { ...wm, size: Number(e.target.value) / 100 } })} /></label>
                <label className="field"><span>{t_("brandBugOpacity")} {Math.round((wm.opacity ?? 0.85) * 100)} %</span><input type="range" min={10} max={100} value={Math.round((wm.opacity ?? 0.85) * 100)} onChange={(e) => setDraft({ ...draft, watermark: { ...wm, opacity: Number(e.target.value) / 100 } })} /></label>
              </>}

              <label className="field"><span>{t_("brandDefaultLong")}</span>
                <button className={`switch ${def === sel ? "on" : ""}`} role="switch" aria-checked={def === sel} aria-label={t_("brandDefaultLong")} onClick={() => setDefault(def !== sel)} disabled={busy} />
              </label>
              <p className="note" style={{ margin: 0 }}>{t_("brandApplyHint")}</p>
            </div>
          )}
        </div>
        {error && <p className="err" style={{ margin: 0 }}>{error}</p>}
        <div className="row">
          {brand && <button className="ghost danger" onClick={remove} disabled={busy} style={{ marginRight: "auto" }}>{t_("delete")}</button>}
          {savedAt > 0 && !dirty && <span className="muted" style={{ alignSelf: "center" }}>✓ {t_("saved")}</span>}
          <button onClick={onClose}>{t_("close")}</button>
          {brand && <button className="primary" onClick={save} disabled={busy || !dirty}>{t_("save")}</button>}
        </div>
      </div>
    </div>
  );
}

function toDraft(b: Brand): BrandInput {
  return { name: b.name, colors: { ...b.colors }, fonts: JSON.parse(JSON.stringify(b.fonts)), tagline: b.tagline ?? "", website: b.website ?? "", handle: b.handle ?? "", watermark: b.watermark ?? null };
}

function cleanColors(c?: Partial<BrandColors>): BrandColors {
  const out: BrandColors = { accent: "#FF5A1F" };
  for (const [k, v] of Object.entries(c ?? {})) if (v && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) (out as unknown as Record<string, string>)[k] = v;
  return out;
}
