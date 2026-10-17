import { useState } from "react";
import { api } from "./api.ts";
import { useT } from "./i18n.ts";
import { LangSwitch } from "./App.tsx";

export function Login({ onDone }: { onDone: () => void }) {
  const t_ = useT();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.login(pw);
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      setError(/Falsches|Wrong/i.test(msg) ? t_("loginWrong") : msg);
      setBusy(false);
    }
  };
  return (
    <main style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 24 }}>
      <form className="modal" style={{ width: 360 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h2>Open Motion</h2><LangSwitch /></div>
        <label className="field" style={{ gridTemplateColumns: "1fr" }}><span>{t_("password")}</span>
          <input type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="primary" disabled={busy || !pw}>{t_("login")}</button>
      </form>
    </main>
  );
}
