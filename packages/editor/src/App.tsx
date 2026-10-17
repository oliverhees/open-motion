import { useEffect, useState } from "react";
import { LangContext, initialLang, type Lang } from "./i18n.ts";
import { ProjectList } from "./ProjectList.tsx";
import { Editor } from "./Editor.tsx";
import { Login } from "./Login.tsx";
import { api } from "./api.ts";

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("om-lang", l); } catch { /* ignore */ }
    document.documentElement.lang = l;
  };
  const hash = useHashRoute();
  const m = /^#\/p\/([a-z0-9-]+)/.exec(hash);
  const [auth, setAuth] = useState<{ required: boolean; ok: boolean } | null>(null);
  const check = () => api.me().then((r) => setAuth({ required: r.required, ok: r.authenticated })).catch(() => setAuth({ required: true, ok: false }));
  useEffect(() => {
    void check();
    const on = () => setAuth((a) => ({ required: a?.required ?? true, ok: false }));
    addEventListener("om-auth", on);
    return () => removeEventListener("om-auth", on);
  }, []);
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {!auth ? null : !auth.ok ? <Login onDone={() => void check()} /> : m ? <Editor key={m[1]} id={m[1]} /> : <ProjectList />}
    </LangContext.Provider>
  );
}

export function LangSwitch() {
  return (
    <LangContext.Consumer>
      {({ lang, setLang }) => (
        <div className="lang" role="group" aria-label="Sprache / Language">
          <button className={lang === "de" ? "on" : ""} onClick={() => setLang("de")}>DE</button>
          <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
        </div>
      )}
    </LangContext.Consumer>
  );
}

export function LogoutButton() {
  const [required, setRequired] = useState(false);
  useEffect(() => { api.me().then((r) => setRequired(r.required)).catch(() => {}); }, []);
  return (
    <LangContext.Consumer>
      {({ lang }) => required ? (
        <button className="ghost" onClick={() => api.logout().finally(() => location.reload())}>{lang === "de" ? "Abmelden" : "Sign out"}</button>
      ) : null}
    </LangContext.Consumer>
  );
}
