// Microphone button: speak instead of typing. Records in the browser, the server transcribes
// (local Whisper or the configured service) and the text lands in the field.
import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { LangContext, useT } from "./i18n.ts";
import { useContext } from "react";

export function Dictate({ onText, compact }: { onText: (text: string) => void; compact?: boolean }) {
  const t_ = useT();
  const { lang } = useContext(LangContext);
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => void finish(r.mimeType);
      r.start(250);
      rec.current = r;
      setSecs(0);
      timer.current = window.setInterval(() => setSecs((s) => (s >= 120 ? (stop(), s) : s + 1)), 1000);
      setState("rec");
    } catch {
      setErr(t_("micDenied"));
    }
  };
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  };
  const finish = async (mime: string) => {
    setState("busy");
    try {
      const blob = new Blob(chunks.current, { type: mime.split(";")[0] || "audio/webm" });
      const r = await api.wait(await api.dictate(blob, lang));
      if (r.text.trim()) onText(r.text.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setState("idle");
    }
  };

  const label = state === "rec" ? t_("micStop", { s: secs }) : state === "busy" ? t_("micBusy") : t_("micStart");
  return (
    <span className="dictate">
      <button type="button" className={`mic ${state}`} disabled={state === "busy"} aria-label={label} title={label} onClick={() => (state === "rec" ? stop() : void start())}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        {!compact && <span>{state === "idle" ? t_("micShort") : label}</span>}
        {compact && state !== "idle" && <span>{state === "rec" ? `${secs}s` : "…"}</span>}
      </button>
      {err && <small className="err">{err}</small>}
    </span>
  );
}
