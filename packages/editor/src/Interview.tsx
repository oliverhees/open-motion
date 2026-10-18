// The interview: a few quick choices with sensible defaults (chips), free text with voice input
// and the style cards. "Build it" turns the answers into a brief and the AI builds the video.
// Also renders questions the AI asks back (AskForm).
import { useState } from "react";
import { getStyle } from "@openmotion/core";
import type { AskQuestion } from "./api.ts";
import { Dictate } from "./Dictate.tsx";
import { StylePicker } from "./StylePicker.tsx";
import { useT, type Key } from "./i18n.ts";

export interface Brief { style: string; text: string }

function Chips({ options, value, onChange, multi }: { options: string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  return (
    <div className="chips" role={multi ? "group" : "radiogroup"}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on}
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o) : [...value, o]) : [o])}>{o}</button>
        );
      })}
    </div>
  );
}

function Free({ value, onChange, placeholder, rows = 1 }: { value: string; onChange: (v: string) => void; placeholder: string; rows?: number }) {
  return (
    <div className="free">
      {rows > 1 ? <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      <Dictate compact onText={(t) => onChange(value ? `${value} ${t}` : t)} />
    </div>
  );
}

export function Interview({ hasRecording, currentStyle, onSubmit, onClose }: { hasRecording: boolean; currentStyle?: string; onSubmit: (b: Brief) => void; onClose: () => void }) {
  const t_ = useT();
  const opts = (k: Key) => t_(k).split("|");
  const lengths = hasRecording ? [t_("ivLenRec"), ...opts("ivLenOpts")] : opts("ivLenOpts");
  const [goal, setGoal] = useState([opts("ivGoalOpts")[0]]);
  const [audience, setAudience] = useState([opts("ivAudOpts")[0]]);
  const [len, setLen] = useState([lengths[0]]);
  const [energy, setEnergy] = useState([opts("ivEnergyOpts")[1]]);
  const [caps, setCaps] = useState([opts("ivCapOpts")[0]]);
  const [content, setContent] = useState("");
  const [ending, setEnding] = useState("");
  const [style, setStyle] = useState(currentStyle ?? "");

  const submit = () => {
    const st = getStyle(style);
    const lines = [
      `${t_("ivGoal")}: ${goal.join(", ")}`,
      `${t_("ivAudience")}: ${audience.join(", ")}`,
      `${t_("ivLength")}: ${len.join(", ")}`,
      `${t_("ivEnergy")}: ${energy.join(", ")}`,
      `${t_("ivStyle")}: ${st ? `${st.name.en} (${st.id})` : t_("styleSurpriseBrief")}`,
      hasRecording ? `${t_("ivCaptions")}: ${caps.join(", ")}` : "",
      content.trim() ? `${t_("ivContent")}: ${content.trim()}` : "",
      ending.trim() ? `${t_("ivEnding")}: ${ending.trim()}` : "",
    ].filter(Boolean);
    onSubmit({ style, text: lines.join("\n") });
  };

  return (
    <div className="interview" role="form" aria-label={t_("ivTitle")}>
      <div className="iv-head"><strong>🎬 {t_("ivTitle")}</strong><button type="button" className="ghost icon" aria-label={t_("close")} onClick={onClose}>×</button></div>
      <p className="muted">{t_("ivLead")}</p>
      <label className="iv-q">{t_("ivContent")}<Free rows={3} value={content} onChange={setContent} placeholder={t_("ivContentPh")} /></label>
      <div className="iv-q">{t_("ivGoal")}<Chips options={opts("ivGoalOpts")} value={goal} onChange={setGoal} /></div>
      <div className="iv-q">{t_("ivAudience")}<Chips options={opts("ivAudOpts")} value={audience} onChange={setAudience} /></div>
      <div className="iv-q">{t_("ivLength")}<Chips options={lengths} value={len} onChange={setLen} /></div>
      <div className="iv-q">{t_("ivEnergy")}<Chips options={opts("ivEnergyOpts")} value={energy} onChange={setEnergy} /></div>
      {hasRecording && <div className="iv-q">{t_("ivCaptions")}<Chips options={opts("ivCapOpts")} value={caps} onChange={setCaps} /></div>}
      <div className="iv-q">{t_("ivStyle")}<StylePicker value={style} onChange={setStyle} allowSurprise /></div>
      <label className="iv-q">{t_("ivEnding")}<Free value={ending} onChange={setEnding} placeholder={t_("ivEndingPh")} /></label>
      <button type="button" className="primary iv-go" onClick={submit}>✦ {t_("ivBuild")}</button>
    </div>
  );
}

/** Questions the AI asked back. */
export function AskForm({ questions, onSubmit }: { questions: AskQuestion[]; onSubmit: (text: string) => void }) {
  const t_ = useT();
  const [ans, setAns] = useState<Record<string, string[]>>(() => Object.fromEntries(questions.map((q) => [q.id, q.options.length && !q.multi ? [q.options[0]] : []])));
  const [free, setFree] = useState<Record<string, string>>({});
  const submit = () => {
    const lines = questions.map((q) => `- ${q.q} → ${[...(ans[q.id] ?? []), free[q.id]?.trim()].filter(Boolean).join(", ") || "—"}`);
    onSubmit(`${t_("askAnswers")}:\n${lines.join("\n")}`);
  };
  return (
    <div className="askform">
      {questions.map((q) => (
        <div key={q.id} className="iv-q">
          {q.q}
          {q.options.length > 0 && <Chips options={q.options} multi={q.multi} value={ans[q.id] ?? []} onChange={(v) => setAns({ ...ans, [q.id]: v })} />}
          {q.free !== false && <Free value={free[q.id] ?? ""} onChange={(v) => setFree({ ...free, [q.id]: v })} placeholder={t_("askOther")} />}
        </div>
      ))}
      <button type="button" className="primary" onClick={submit}>{t_("askSend")}</button>
    </div>
  );
}
