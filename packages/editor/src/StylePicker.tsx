// Style cards: a real mini preview of each art direction (its background, display font, accent, palette).
// Fonts come from our own server (/api/fontfile), never straight from Google.
import { useContext, useEffect } from "react";
import { STYLES, type StyleDef } from "@openmotion/core";
import { api } from "./api.ts";
import { LangContext, useT } from "./i18n.ts";

const loaded = new Set<string>();
/** Registers the display fonts of all styles once (served by our server). */
export function useStyleFonts() {
  useEffect(() => {
    for (const st of STYLES) {
      const fam = st.fonts.display;
      if (loaded.has(fam)) continue;
      loaded.add(fam);
      const face = new FontFace(`om-pv-${fam}`, `url(${api.fontUrl(fam)})`);
      face.load().then((f) => document.fonts.add(f)).catch(() => {});
    }
  }, []);
}

export function StyleCard({ st, on, onPick }: { st: StyleDef; on: boolean; onPick: () => void }) {
  const { lang } = useContext(LangContext);
  const p = st.palette;
  const sample = { keynote: "Think.", swiss: "Grid 01", velvet: "Noir", kinetic: "BOLD", brutal: "RAW!", glass: "Depth", editorial: "Story", data: "+48%", doodle: "Idea!", collage: "Paper", vhs: "VHS", neon: "HUD_", pastel: "Hi!", creator: "WOW" }[st.id] ?? "Aa";
  return (
    <button type="button" className={`stylecard${on ? " on" : ""}`} onClick={onPick} aria-pressed={on}>
      <span className="sc-pv" style={{ background: p.bg }}>
        <span className="sc-glow" style={{ background: `radial-gradient(circle at 75% 30%, ${p.accent}55, transparent 60%)` }} />
        <span className="sc-word" style={{ fontFamily: `"om-pv-${st.fonts.display}", system-ui`, fontWeight: st.fonts.displayWeight, color: p.ink }}>
          {sample}<i style={{ background: p.accent }} />
        </span>
        <span className="sc-sw">{Object.entries(p).filter(([k]) => k !== "bg").slice(0, 5).map(([k, v]) => <i key={k} style={{ background: v }} />)}</span>
      </span>
      <strong>{st.name[lang]}</strong>
      <small>{st.mood[lang]}</small>
    </button>
  );
}

export function StylePicker({ value, onChange, allowSurprise }: { value: string; onChange: (id: string) => void; allowSurprise?: boolean }) {
  const t_ = useT();
  useStyleFonts();
  return (
    <div className="stylegrid">
      {allowSurprise && (
        <button type="button" className={`stylecard surprise${value === "" ? " on" : ""}`} onClick={() => onChange("")} aria-pressed={value === ""}>
          <span className="sc-pv"><span className="sc-word">✦</span></span>
          <strong>{t_("styleSurprise")}</strong>
          <small>{t_("styleSurpriseSub")}</small>
        </button>
      )}
      {STYLES.map((st) => <StyleCard key={st.id} st={st} on={value === st.id} onPick={() => onChange(st.id)} />)}
    </div>
  );
}
