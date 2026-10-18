import { useEffect, useState } from "react";
import { api, fmtTime, type ProjectInfo } from "./api.ts";
import { useT, LangContext } from "./i18n.ts";
import { useContext } from "react";
import { LangSwitch, LogoutButton } from "./App.tsx";
import { StylePicker } from "./StylePicker.tsx";
import { BrandsDialog } from "./BrandsDialog.tsx";
import type { Brand } from "@openmotion/core";

export function ProjectList() {
  const t = useT();
  const { lang } = useContext(LangContext);
  const [list, setList] = useState<ProjectInfo[] | null>(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<"blank" | "example">("blank");
  const [format, setFormat] = useState<string>("16:9");
  const [style, setStyle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState<string>("");
  const [showBrands, setShowBrands] = useState(false);
  const loadBrands = () => api.brands().then((r) => { setBrands(r.brands); setBrand((cur) => (cur && r.brands.some((b) => b.id === cur) ? cur : r.default ?? "")); }).catch(() => {});

  useEffect(() => { api.list().then(setList).catch((e: Error) => setError(e.message)); void loadBrands(); }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.create(title || t("titlePlaceholder"), template, lang, template === "blank" ? format : undefined, template === "blank" && style ? style : undefined, template === "blank" ? (brand || null) : null);
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Open Motion</h1>
        <span style={{ display: "flex", gap: 8 }}><button className="ghost" onClick={() => setShowBrands(true)}>🎨 {t("brands")}</button><LogoutButton /><LangSwitch /></span>
      </div>
      <p className="lead">{t("appLead")}</p>
      <form className="newvideo" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <strong style={{ fontSize: 15 }}>✦ {t("newVideo")}</strong>
        <div className="row">
          <label>{t("title")}<input value={title} placeholder={t("titlePlaceholder")} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>{t("template")}
            <select value={template} onChange={(e) => setTemplate(e.target.value as "blank" | "example")}>
              <option value="blank">{t("templateBlank")}</option>
              <option value="example">{t("templateExample")}</option>
            </select>
          </label>
        </div>
        {template === "blank" && <>
          <div className="lbl">{t("format")}
            <div className="formats" role="radiogroup">
              {([["16:9", "fmt169", 32, 18], ["9:16", "fmt916", 14, 25], ["1:1", "fmt11", 22, 22], ["4:5", "fmt45", 20, 25]] as const).map(([f, k, w, h]) => (
                <button key={f} type="button" className={`fmt${format === f ? " on" : ""}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
                  <i style={{ width: w, height: h }} /><span>{f}</span><small>{t(k)}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="lbl">{t("ivStyle")}<StylePicker value={style} onChange={setStyle} allowSurprise /></div>
          <div className="lbl">{t("brandSection")}
            <div className="brandpick">
              <button type="button" className={`fmt${brand === "" ? " on" : ""}`} aria-pressed={brand === ""} onClick={() => setBrand("")}><span>{t("brandNone")}</span></button>
              {brands.map((b) => (
                <button key={b.id} type="button" className={`fmt${brand === b.id ? " on" : ""}`} aria-pressed={brand === b.id} onClick={() => setBrand(b.id)}>
                  {b.logo ? <img src={api.brandLogoUrl(b)} alt="" /> : <i style={{ background: b.colors.accent, width: 14, height: 14, borderRadius: 7 }} />}<span>{b.name}</span>
                </button>
              ))}
              <button type="button" className="ghost" onClick={() => setShowBrands(true)}>{brands.length ? t("brandManage") : `＋ ${t("brandAdd")}`}</button>
            </div>
          </div>
        </>}
        <button className="primary" disabled={busy} style={{ justifySelf: "start", padding: "9px 18px" }}>{busy ? t("creating") : t("create")}</button>
      </form>
      {error && <p className="err">{error}</p>}
      {showBrands && <BrandsDialog onClose={() => { setShowBrands(false); void loadBrands(); }} />}
      {list === null ? <p className="muted">{t("loading")}</p> : list.length === 0 ? (
        <div className="empty"><strong>{t("emptyTitle")}</strong><p>{t("emptyBody")}</p></div>
      ) : (
        <div className="plist">
          {list.map((p) => (
            <div key={p.id} className="prow" role="link" tabIndex={0} onClick={() => (location.hash = `#/p/${p.id}`)}
              onKeyDown={(e) => e.key === "Enter" && (location.hash = `#/p/${p.id}`)}>
              <strong>{p.title}</strong>
              <span className="muted num">{p.duration ? fmtTime(p.duration) : ""}</span>
              <span className="muted">{t("updated")} {new Date(p.updatedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
