import { useEffect, useRef, useState } from "react";
import type { FacecamLayout } from "@openmotion/core";
import { useT } from "./i18n.ts";

interface Props { onClose: () => void; onDone: (blob: Blob, ext: string, layout: FacecamLayout, transcribe: boolean) => void }

/** Records camera + microphone in the browser (MediaRecorder). The server converts the WebM to MP4. */
export function RecordDialog({ onClose, onDone }: Props) {
  const t_ = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cam, setCam] = useState("");
  const [mic, setMic] = useState("");
  const [phase, setPhase] = useState<"idle" | "count" | "rec" | "done">("idle");
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<FacecamLayout>("right");
  const [transcribe, setTranscribe] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        stream.current?.getTracks().forEach((tr) => tr.stop());
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(cam ? { deviceId: { exact: cam } } : {}) },
          audio: { echoCancellation: true, noiseSuppression: true, ...(mic ? { deviceId: { exact: mic } } : {}) },
        });
        if (!alive) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream.current = s;
        if (video.current) video.current.srcObject = s;
        const devs = await navigator.mediaDevices.enumerateDevices();
        setCams(devs.filter((d) => d.kind === "videoinput"));
        setMics(devs.filter((d) => d.kind === "audioinput"));
        setError(null);
      } catch (e) {
        setError(t_("camError", { e: (e as Error).message }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam, mic]);

  useEffect(() => () => stream.current?.getTracks().forEach((tr) => tr.stop()), []);

  useEffect(() => {
    if (phase !== "count") return;
    if (count === 0) { begin(); return; }
    const h = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count]);

  useEffect(() => {
    if (phase !== "rec") return;
    const h = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(h);
  }, [phase]);

  const mime = () => ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const begin = () => {
    if (!stream.current) return;
    chunks.current = [];
    const r = new MediaRecorder(stream.current, { mimeType: mime(), videoBitsPerSecond: 8_000_000 });
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => { setBlob(new Blob(chunks.current, { type: r.mimeType })); setPhase("done"); };
    r.start(1000);
    rec.current = r;
    setSecs(0);
    setPhase("rec");
  };
  const stop = () => rec.current?.state === "recording" && rec.current.stop();
  const ext = blob?.type.includes("mp4") ? "mp4" : "webm";

  return (
    <div className="modal-bg">
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="rec-title">
        <h2 id="rec-title">{t_("recordTitle")}</h2>
        <div className="rec-overlay">
          <video ref={video} className="rec-video" autoPlay muted playsInline />
          {phase === "count" && <div className="rec-count">{count}</div>}
          {phase === "rec" && <span className="rec-badge num">● {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>}
        </div>
        {error && <p className="err" style={{ margin: 0 }}>{error}</p>}
        {phase !== "done" ? (
          <>
            <div className="pair">
              <label className="field" style={{ gridTemplateColumns: "1fr" }}><span>{t_("camera")}</span>
                <select value={cam} onChange={(e) => setCam(e.target.value)} disabled={phase !== "idle"}>
                  {cams.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t_("camera")} ${i + 1}`}</option>)}
                </select></label>
              <label className="field" style={{ gridTemplateColumns: "1fr" }}><span>{t_("microphone")}</span>
                <select value={mic} onChange={(e) => setMic(e.target.value)} disabled={phase !== "idle"}>
                  {mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t_("microphone")} ${i + 1}`}</option>)}
                </select></label>
            </div>
            <div className="row">
              <button onClick={() => { stop(); onClose(); }}>{t_("cancel")}</button>
              {phase === "rec" ? <button className="primary" onClick={stop}>■ {t_("stopRec")}</button>
                : <button className="primary" disabled={!!error || phase === "count"} onClick={() => { setCount(3); setPhase("count"); }}>● {t_("startRec")}</button>}
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0 }}>{t_("recSaved")} <span className="muted num">({secs} s, {((blob?.size ?? 0) / 1e6).toFixed(1)} MB)</span></p>
            <label className="field"><span>{t_("layout")}</span>
              <select value={layout} onChange={(e) => setLayout(e.target.value as FacecamLayout)}>
                {(["right", "corner", "circle", "split", "full"] as const).map((l) => <option key={l} value={l}>{t_(`layout${l[0].toUpperCase()}${l.slice(1)}` as "layoutRight")}</option>)}
              </select></label>
            <label className="field" style={{ gridTemplateColumns: "auto 1fr" }}><input type="checkbox" style={{ width: "auto" }} checked={transcribe} onChange={(e) => setTranscribe(e.target.checked)} /><span>{t_("alsoTranscribe")}</span></label>
            <div className="row">
              <button onClick={() => { setBlob(null); setPhase("idle"); }}>{t_("recAgain")}</button>
              <button className="primary" onClick={() => blob && onDone(blob, ext, layout, transcribe)}>{t_("insertFacecam")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
