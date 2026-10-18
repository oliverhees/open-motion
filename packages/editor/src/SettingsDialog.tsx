import { useEffect, useState } from "react";
import { api, type Integrations, type ImageProvider, type LlmProvider, type Provider, type PublicSettings } from "./api.ts";
import { BrandsDialog } from "./BrandsDialog.tsx";
import { useT, type Key } from "./i18n.ts";

const PROVIDERS: Provider[] = ["local", "openai", "elevenlabs", "groq", "deepgram"];
const KEYED = ["anthropic", "openai", "openrouter", "kie", "gemini", "elevenlabs", "groq", "deepgram"] as const;
const LLMS: LlmProvider[] = ["claude-code", "codex", "opencode", "anthropic", "openai", "openrouter"];
const IMGS: ImageProvider[] = ["kie", "openai", "openrouter", "gemini"];
const LLM_DEFAULTS: Record<LlmProvider, string> = { anthropic: "claude-sonnet-5-5", openai: "gpt-5", openrouter: "anthropic/claude-sonnet-5.5", "claude-code": "", codex: "", opencode: "" };
const CLI_LLMS: LlmProvider[] = ["claude-code", "codex", "opencode"];
const IMG_DEFAULTS: Record<ImageProvider, string> = { kie: "gpt-image-2-text-to-image", openai: "gpt-image-1", openrouter: "google/gemini-2.5-flash-image", gemini: "gemini-2.5-flash-image" };
const DEFAULT_MODELS: Record<Provider, string> = { local: "small", openai: "whisper-1", elevenlabs: "scribe_v1", groq: "whisper-large-v3-turbo", deepgram: "nova-3" };

export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (s: PublicSettings) => void }) {
  const t_ = useT();
  const [s, setS] = useState<PublicSettings | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<{ checks: { area: string; name: string; ok: boolean | null; ms: number; detail: string; hint?: string }[]; report: string } | null>(null);
  const [diagBusy, setDiagBusy] = useState<number | null>(null);
  const [diagOpts, setDiagOpts] = useState({ images: false, agent: false });
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<{ id: string; name: string; prefix: string; createdAt: string; lastUsed?: string }[] | null>(null);
  const [tokName, setTokName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => { api.tokens().then(setTokens).catch(() => setTokens(null)); }, []);
  const [integ, setInteg] = useState<Integrations | null>(null);
  const [showBrands, setShowBrands] = useState(false);
  useEffect(() => { api.integrations().then(setInteg).catch(() => setInteg(null)); }, []);
  const makeToken = async () => {
    try {
      const r = await api.createToken(tokName || "KI");
      setFresh(r.token);
      setTokName("");
      setTokens(await api.tokens());
    } catch (e) { setError((e as Error).message); }
  };
  const [, tick] = useState(0);
  useEffect(() => { if (diagBusy === null) return; const h = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(h); }, [diagBusy]);
  const runDiag = async () => {
    setDiag(null); setCopied(false); setError(null); setDiagBusy(Date.now());
    try { setDiag(await api.wait(await api.diagnose(diagOpts))); } catch (e) { setError((e as Error).message); } finally { setDiagBusy(null); }
  };
  useEffect(() => { api.settings().then(setS).catch((e: Error) => setError(e.message)); }, []);
  if (!s) return <div className="modal-bg"><div className="modal">{error ? <p className="err">{error}</p> : <p className="muted">{t_("loading")}</p>}</div></div>;

  const save = async (extra?: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const filled = { ...Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim())), ...extra };
      const r = await api.saveSettings({ transcription: s.transcription, ai: { provider: s.ai.provider, model: s.ai.model ?? "", review: s.ai.review !== false }, images: { provider: s.images.provider, model: s.images.model ?? "" }, keys: filled });
      setS(r);
      setKeys({});
      onSaved(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tr = s.transcription;
  const setTr = (patch: Partial<PublicSettings["transcription"]>) => setS({ ...s, transcription: { ...tr, ...patch } });

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="set-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="set-title">{t_("settings")}</h2>
        <div className="sec">
          <h3>{t_("brands")}</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setShowBrands(true)}>🎨 {t_("brandManage")}</button>
            <span className="muted">{t_("brandsShort")}</span>
          </div>
        </div>
        {showBrands && <BrandsDialog onClose={() => setShowBrands(false)} />}
        <div className="sec">
          <h3>{t_("aiModel")}</h3>
          <div className="pair">
            <select value={s.ai.provider} onChange={(e) => setS({ ...s, ai: { ...s.ai, provider: e.target.value as LlmProvider, model: "" } })}>
              {LLMS.map((p) => <option key={p} value={p}>{t_(`p_${p}` as Key)}</option>)}
            </select>
            <input value={s.ai.model ?? ""} placeholder={s.ai.provider === "opencode" ? "anthropic/claude-sonnet-4-5" : LLM_DEFAULTS[s.ai.provider]} onChange={(e) => setS({ ...s, ai: { ...s.ai, model: e.target.value } })} aria-label={t_("model")} />
          </div>
          {CLI_LLMS.includes(s.ai.provider) && <p className="muted" style={{ margin: "4px 0 0" }}>{t_("cliNote")}</p>}
          {s.ai.provider === "opencode" && <p className="muted" style={{ margin: "4px 0 0" }}>{t_("opencodeNote")}</p>}
          <label className="check" style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
            <input type="checkbox" style={{ width: "auto", marginTop: 2 }} checked={s.ai.review !== false} onChange={(e) => setS({ ...s, ai: { ...s.ai, review: e.target.checked } })} />
            <span>{t_("reviewSetting")}</span>
          </label>
          <h3>{t_("imageModel")}</h3>
          <div className="pair">
            <select value={s.images.provider} onChange={(e) => setS({ ...s, images: { ...s.images, provider: e.target.value as ImageProvider, model: "" } })}>
              {IMGS.map((p) => <option key={p} value={p}>{t_(`p_${p}` as Key)}</option>)}
            </select>
            <input value={s.images.model ?? ""} placeholder={IMG_DEFAULTS[s.images.provider]} onChange={(e) => setS({ ...s, images: { ...s.images, model: e.target.value } })} aria-label={t_("model")} />
          </div>
          {integ && (
            <div className="integ">
              <span className={integ.images ? "ok" : "warn"}>{integ.images ? `✓ ${t_("imgReady")}` : `○ ${t_("imgOff")}`}</span>
              {integ.kieCredits !== null && <span>Kie.ai: {t_("kieCredits", { n: Math.round(integ.kieCredits) })}</span>}
              {integ.kieMcp.length > 0 && <span>✓ {t_("kieMcpFound", { where: integ.kieMcp.map((x) => `${x.tool} (${x.name})`).join(", ") })}</span>}
              {integ.mcps.length > 0 && <small className="muted">{t_("mcpsFound", { list: [...new Set(integ.mcps.map((x) => x.tool))].join(", ") })}</small>}
            </div>
          )}
        </div>
        <div className="sec">
          <h3>{t_("transcript")}</h3>
          <label className="field"><span>{t_("defaultProvider")}</span>
            <select value={tr.provider} onChange={(e) => setTr({ provider: e.target.value as Provider })}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{t_(`p_${p}` as Key)}</option>)}
            </select></label>
          <label className="field"><span>{t_("language")}</span><input value={tr.language} onChange={(e) => setTr({ language: e.target.value })} placeholder="de" /></label>
          {PROVIDERS.map((p) => (
            <label key={p} className="field"><span>{t_("model")}: {t_(`p_${p}` as Key).split(" ")[0]}</span>
              <input value={tr.models[p] ?? ""} placeholder={DEFAULT_MODELS[p]} onChange={(e) => setTr({ models: { ...tr.models, [p]: e.target.value } })} /></label>
          ))}
        </div>
        <div className="sec">
          <h3>{t_("apiKeys")}</h3>
          {KEYED.map((k) => (
            <div key={k} className="keyrow">
              <span>{t_(`p_${k}` as Key)}<br /><small>{s.keys[k]?.set ? t_("keySet", { h: s.keys[k].hint ?? "" }) : t_("keyMissing")}</small></span>
              <input type="password" autoComplete="off" placeholder={t_("keyPlaceholder")} value={keys[k] ?? ""} onChange={(e) => setKeys({ ...keys, [k]: e.target.value })} />
              {s.keys[k]?.set ? <button className="ghost" onClick={() => void save({ [k]: "" })}>{t_("deleteKey")}</button> : <span />}
            </div>
          ))}
          <p className="note">{t_("keyNote")}</p>
        </div>
        {tokens && (
          <div className="sec">
            <h3>{t_("tokensTitle")}</h3>
            <p className="note">{t_("tokensNote")}</p>
            <div className="pair">
              <input value={tokName} placeholder={t_("tokenName")} onChange={(e) => setTokName(e.target.value)} />
              <button onClick={() => void makeToken()}>🔑 {t_("tokenCreate")}</button>
            </div>
            {fresh && (
              <div style={{ display: "grid", gap: 6 }}>
                <p className="warn">{t_("tokenShownOnce")}</p>
                <code style={{ background: "var(--stage-bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px", overflowWrap: "anywhere", fontSize: 12 }}>{fresh}</code>
                <button onClick={() => void navigator.clipboard?.writeText(fresh)}>📋 {t_("diagCopy").replace(/Bericht|report/i, "Token")}</button>
                <p className="note">{t_("tokenUse")}</p>
              </div>
            )}
            {tokens.map((tk) => (
              <div key={tk.id} className="keyrow">
                <span>{tk.name}<br /><small>{tk.prefix}… · {tk.lastUsed ? `${t_("tokenLastUsed")} ${new Date(tk.lastUsed).toLocaleString()}` : t_("tokenNever")}</small></span>
                <span />
                <button className="ghost" onClick={() => void api.revokeToken(tk.id).then(() => api.tokens().then(setTokens))}>{t_("tokenRevoke")}</button>
              </div>
            ))}
          </div>
        )}
        <div className="sec">
          <h3>{t_("diagTitle")}</h3>
          {Object.values(keys).some((v) => v.trim()) && <p className="warn">{t_("diagSaveFirst")}</p>}
          <label className="field" style={{ gridTemplateColumns: "auto 1fr" }}><input type="checkbox" style={{ width: "auto" }} checked={diagOpts.images} onChange={(e) => setDiagOpts({ ...diagOpts, images: e.target.checked })} /><span>{t_("diagImages")}</span></label>
          <label className="field" style={{ gridTemplateColumns: "auto 1fr" }}><input type="checkbox" style={{ width: "auto" }} checked={diagOpts.agent} onChange={(e) => setDiagOpts({ ...diagOpts, agent: e.target.checked })} /><span>{t_("diagAgent")}</span></label>
          <button disabled={diagBusy !== null} onClick={() => void runDiag()}>{diagBusy !== null ? t_("diagRunning", { s: Math.round((Date.now() - diagBusy) / 1000) }) : `🩺 ${t_("diagRun")}`}</button>
          {diag && (
            <div style={{ display: "grid", gap: 6 }}>
              {diag.checks.map((c, i) => (
                <div key={i} style={{ fontSize: 12, display: "grid", gridTemplateColumns: "18px 1fr", gap: 6 }}>
                  <span style={{ color: c.ok === null ? "var(--faint)" : c.ok ? "var(--ok)" : "var(--danger)" }}>{c.ok === null ? "–" : c.ok ? "✓" : "✗"}</span>
                  <span><strong>{c.area}: {c.name}</strong> <span className="muted">{c.detail}</span>{c.hint && <><br /><span className="warn">→ {c.hint}</span></>}</span>
                </div>
              ))}
              <button onClick={() => { void navigator.clipboard?.writeText(diag.report).then(() => setCopied(true)); }}>📋 {t_("diagCopy")}</button>
              {copied && <p className="note">{t_("diagCopied")}</p>}
            </div>
          )}
        </div>
        {error && <p className="err" style={{ margin: 0 }}>{error}</p>}
        <div className="row">
          <button onClick={onClose}>{t_("close")}</button>
          <button className="primary" disabled={busy} onClick={() => void save()}>{t_("save")}</button>
        </div>
      </div>
    </div>
  );
}
