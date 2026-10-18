import { useEffect, useRef, useState } from "react";
import type { AiProgress, ChatEntry } from "./api.ts";
import { useT } from "./i18n.ts";

interface Props {
  entries: ChatEntry[];
  busy: { label: string; started: number; progress?: AiProgress } | null;
  model: string;
  queued: number;
  hasTranscript: boolean;
  canUndo: (id: string) => boolean;
  onSend: (text: string) => void;
  onTranscript: () => void;
  onComments: () => void;
  onUndo: (id: string) => void;
  onClose: () => void;
}

/** Left chat panel, like Motion: describe the video, ask for changes, see what changed, undo per answer. */
export function ChatPanel(p: Props) {
  const t_ = useT();
  const [text, setText] = useState("");
  const [, tick] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [p.entries.length, p.busy, p.busy?.progress?.text]);
  useEffect(() => {
    if (!p.busy) return;
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [p.busy]);
  const send = () => {
    const v = text.trim();
    if (!v || p.busy) return;
    p.onSend(v);
    setText("");
  };
  return (
    <aside className="chat" aria-label={t_("aiOpen")}>
      <div className="chat-head"><strong>✦ {t_("aiTitle")}</strong><small title={p.model}>{p.model}</small>
        <button className="ghost icon" aria-label={t_("close")} title={t_("close")} onClick={p.onClose}>×</button></div>
      <div className="chat-log" ref={log} aria-live="polite">
        {p.entries.length === 0 && <p className="muted" style={{ margin: 0 }}>{t_("aiEmpty")}</p>}
        {p.entries.map((e) => (
          <div key={e.id} className={`msg ${e.role}`}>
            {e.text}
            {e.role === "assistant" && (e.ops ?? 0) > 0 && (
              <div className="meta">
                <span>{e.ops === 1 ? t_("aiChange1") : t_("aiChanges", { n: e.ops ?? 0 })}{e.images?.length ? ` · ${e.images.length === 1 ? t_("aiImage1") : t_("aiImages", { n: e.images.length })}` : ""}</span>
                {e.undone ? <span>· {t_("aiUndone")}</span> : p.canUndo(e.id) && <button onClick={() => p.onUndo(e.id)}>{t_("aiUndo")}</button>}
              </div>
            )}
          </div>
        ))}
        {p.busy && <Live busy={p.busy} />}
      </div>
      <div className="chat-foot">
        <div className="quick">
          {p.hasTranscript && <button disabled={!!p.busy} onClick={p.onTranscript}>✨ {t_("aiFromTranscript")}</button>}
          {p.queued > 0 && <button disabled={!!p.busy} onClick={p.onComments}>💬 {t_("aiComments", { n: p.queued })}</button>}
        </div>
        <textarea value={text} placeholder={t_("aiPlaceholder")} aria-label={t_("aiPlaceholder")} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="primary" disabled={!text.trim() || !!p.busy} onClick={send}>{t_("send")}</button>
      </div>
    </aside>
  );
}

/** What the AI is doing right now: its answer as far as written, the number of changes, or the current step. */
function Live({ busy }: { busy: { label: string; started: number; progress?: AiProgress } }) {
  const t_ = useT();
  const pr = busy.progress;
  const secs = Math.round((Date.now() - busy.started) / 1000);
  const step = !pr || pr.phase === "thinking" ? t_("aiThinking", { s: secs })
    : pr.phase === "writing" ? (pr.ops !== undefined ? t_("aiBuilding", { n: pr.ops, s: secs }) : t_("aiWriting", { s: secs }))
    : pr.phase === "checking" ? t_("aiChecking")
    : pr.phase === "retry" ? t_("aiRetry", { n: pr.n ?? 2 })
    : t_("aiMakingImage", { n: pr.n ?? 1, of: pr.of ?? 1 });
  return (
    <>
      {pr?.text && <div className="msg assistant live">{pr.text}</div>}
      <div className="thinking">{busy.label} · {step}</div>
    </>
  );
}
