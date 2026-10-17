import { useEffect, useState } from "react";
import { compositionDuration, type MotionSpec } from "@openmotion/core";
import { api, type Estimate, type ExportRequest, type Job } from "./api.ts";
import { useT } from "./i18n.ts";

export function ExportDialog({ projectId, spec, onClose }: { projectId: string; spec: MotionSpec; onClose: () => void }) {
  const t_ = useT();
  const [req, setReq] = useState<ExportRequest>({ format: "mp4", height: 1080, fps: 30, quality: "medium", sharpText: false });
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [est, setEst] = useState<Estimate | null>(null);
  useEffect(() => {
    const h = setTimeout(() => { api.estimate(projectId, req).then(setEst).catch(() => setEst(null)); }, 250);
    return () => clearTimeout(h);
  }, [projectId, req]);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const h = setInterval(() => {
      setNow(Date.now());
      api.job(job.id).then((j) => setJob((cur) => ({ ...j, workerOnline: cur?.workerOnline }))).catch((e: Error) => setError(e.message));
    }, 1500);
    return () => clearInterval(h);
  }, [job]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  void compositionDuration(spec);
  const secs = est?.seconds ?? 0;
  const estText = !est ? "…" : secs < 90 ? `~${secs} s` : `~${Math.round(secs / 60)} min`;
  const running = job?.status === "running" && job.startedAt ? (now - job.startedAt) / 1000 : 0;
  const progress = job?.status === "running" && job.estimateSeconds ? Math.min(0.97, running / job.estimateSeconds) : job?.status === "done" ? 1 : 0;
  const opt = <K extends keyof ExportRequest>(k: K, v: ExportRequest[K]) => setReq((r) => ({ ...r, [k]: v, ...(k === "format" && v === "gif" ? { fps: 15, sharpText: false } : {}) }));
  const Seg = <K extends keyof ExportRequest>({ k, items }: { k: K; items: [ExportRequest[K], string][] }) => (
    <div className="seg" style={{ minWidth: 200 }}>{items.map(([v, label]) => <button key={String(v)} className={req[k] === v ? "on" : ""} onClick={() => opt(k, v)}>{label}</button>)}</div>
  );

  const start = () => {
    setError(null);
    api.exportStart(projectId, req).then(setJob).catch((e: Error) => setError(e.message));
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="exp-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="exp-title">{t_("exportTitle")}</h2>
        <div className="field"><span>{t_("format")}</span><Seg k="format" items={[["mp4", "MP4"], ["gif", "GIF"]]} /></div>
        <div className="field"><span>{t_("resolution")}</span><Seg k="height" items={[[720, "720p"], [1080, "1080p"]]} /></div>
        <div className="field"><span>{t_("frameRate")}</span><Seg k="fps" items={[[60, "60"], [30, "30"], [15, "15"]]} /></div>
        <div className="field"><span>{t_("quality")}</span><Seg k="quality" items={[["high", t_("high")], ["medium", t_("medium")], ["low", t_("low")]]} /></div>
        {req.format === "mp4" && (
          <div className="field"><span>{t_("sharpText")}</span>
            <button className={`switch ${req.sharpText ? "on" : ""}`} role="switch" aria-checked={req.sharpText} aria-label={t_("sharpText")} onClick={() => opt("sharpText", !req.sharpText)} /></div>
        )}
        <p className="muted" style={{ margin: 0 }}>{t_("estimate", { t: estText })}{est && <> · <span>{est.calibrated ? t_("estimateMeasured") : t_("estimateGuess")}</span></>}</p>
        {est && <p className="note">{t_("server")}: {est.plan.info ? t_("planLine", { cores: est.plan.info.cores, c: est.plan.info.container ? t_("planContainer") : "", mem: est.plan.info.memGB, load: est.plan.info.load, workers: est.plan.workers, limit: t_(`lim_${est.plan.info.limit}` as "lim_cpu"), gpu: est.plan.info.gpuName ? `, GPU: ${est.plan.info.gpuName}` : "" }) : est.plan.reason}</p>}
        {job && job.status !== "error" && <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
        {job && (
          <p style={{ margin: 0 }} aria-live="polite">
            {job.status === "queued" && t_("queued")}
            {job.status === "running" && t_("rendering", { s: Math.round((now - (job.startedAt ?? now)) / 1000) })}
            {job.status === "done" && <>{t_("done")} · <a href={`/projects/${projectId}/${job.file}?download`} style={{ color: "var(--sel)" }}>{t_("download")}</a> <span className="muted">({((job.size ?? 0) / 1e6).toFixed(1)} MB)</span></>}
            {job.status === "error" && <span className="err">{t_("failed")}: {job.error}</span>}
          </p>
        )}
        {job && job.workerOnline === false && job.status === "queued" && <p className="warn">{t_("workerOffline")}</p>}
        {error && <p className="err" style={{ margin: 0 }}>{error}</p>}
        <div className="row">
          <button onClick={onClose}>{t_("close")}</button>
          <button className="primary" onClick={start} disabled={job?.status === "queued" || job?.status === "running"}>{t_("startExport")}</button>
        </div>
      </div>
    </div>
  );
}
