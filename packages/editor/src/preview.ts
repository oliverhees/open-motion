// Preview: the real composition in an iframe, updated in place.
// Only layers whose compiled HTML changed get new DOM. Moving a video does not reload it.

import { compile, type MotionSpec } from "@openmotion/core";

interface OmRuntime {
  seek(t: number): void;
  play(from?: number): void;
  pause(): number;
  time(): number;
  isPlaying(): boolean;
  rebuild(defs: unknown[], duration?: number): void;
}

export class Preview {
  private iframe: HTMLIFrameElement;
  private base: string;
  private sig = "";
  private cache = new Map<string, string>();
  private loading: Promise<void> | null = null;
  private pendingT = 0;

  constructor(iframe: HTMLIFrameElement, base: string) {
    this.iframe = iframe;
    this.base = base;
  }

  private get om(): OmRuntime | undefined {
    return (this.iframe.contentWindow as unknown as { __om?: OmRuntime })?.__om;
  }
  private get doc(): Document | null {
    return this.iframe.contentDocument;
  }

  /** Full (re)load. Used first time and when structure changes (layer added/removed/reordered, canvas, fonts). */
  load(spec: MotionSpec, t: number): Promise<void> {
    const c = compile(spec);
    this.sig = signature(spec);
    this.remember(c.html);
    this.pendingT = t;
    this.loading = new Promise((resolve) => {
      this.iframe.onload = () => {
        this.om?.seek(this.pendingT);
        this.loading = null;
        resolve();
      };
    });
    this.iframe.srcdoc = c.html.replace("<head>", `<head><base href="${this.base}">`);
    return this.loading;
  }

  /** Hot update. Returns false if a full reload was needed. */
  update(spec: MotionSpec, editingId: string | null): boolean {
    if (this.loading) {
      void this.loading.then(() => this.update(spec, editingId));
      return true;
    }
    const doc = this.doc;
    const om = this.om;
    if (!doc || !om || signature(spec) !== this.sig) {
      void this.load(spec, om?.time() ?? this.pendingT);
      return false;
    }
    const c = compile(spec);
    const parsed = new DOMParser().parseFromString(c.html, "text/html");
    const root = doc.getElementById("root");
    const newRoot = parsed.getElementById("root");
    if (root && newRoot) {
      root.setAttribute("style", newRoot.getAttribute("style") ?? "");
      root.setAttribute("data-duration", newRoot.getAttribute("data-duration") ?? "0");
    }
    for (const layer of spec.layers) {
      if (layer.hidden) continue;
      const id = layer.id;
      if (layer.type === "audio") {
        const fresh = parsed.getElementById(`om-c-${id}`);
        const old = doc.getElementById(`om-c-${id}`);
        if (fresh && old && this.cache.get(id) !== fresh.outerHTML) {
          old.replaceWith(doc.importNode(fresh, true));
          this.cache.set(id, fresh.outerHTML);
        }
        continue;
      }
      const fresh = parsed.getElementById(`om-${id}`);
      const old = doc.getElementById(`om-${id}`);
      if (!fresh || !old) continue;
      old.setAttribute("style", fresh.getAttribute("style") ?? "");
      const freshFx = fresh.querySelector(".om-fx");
      const oldFx = old.querySelector(".om-fx");
      if (!freshFx || !oldFx) continue;
      if (id !== editingId && this.cache.get(id) !== freshFx.innerHTML) {
        oldFx.replaceChildren(...Array.from(freshFx.childNodes).map((n) => doc.importNode(n, true)));
        this.cache.set(id, freshFx.innerHTML);
      }
    }
    om.rebuild(c.anims, c.duration);
    return true;
  }

  seek(t: number) { this.pendingT = t; this.om?.seek(t); }
  play(from: number) { this.om?.play(from); }
  pause(): number { return this.om?.pause() ?? this.pendingT; }
  time(): number { return this.om?.time() ?? this.pendingT; }
  isPlaying(): boolean { return this.om?.isPlaying() ?? false; }

  /** Type directly into a text layer inside the preview. */
  beginTextEdit(id: string, onInput: (text: string) => void, onDone: () => void): boolean {
    const doc = this.doc;
    const el = doc?.getElementById(`om-c-${id}`) as HTMLElement | null;
    if (!doc || !el) return false;
    this.iframe.style.pointerEvents = "auto";
    el.setAttribute("contenteditable", "plaintext-only");
    el.style.outline = "3px solid #5b9dff";
    el.style.cursor = "text";
    el.style.visibility = "";
    this.iframe.contentWindow?.focus();
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    doc.getSelection()?.removeAllRanges();
    doc.getSelection()?.addRange(range);
    const input = () => onInput(el.innerText.replace(/\n$/, ""));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        el.blur();
      }
    };
    const blur = () => {
      el.removeAttribute("contenteditable");
      el.style.outline = "";
      el.style.cursor = "";
      this.iframe.style.pointerEvents = "none";
      el.removeEventListener("input", input);
      el.removeEventListener("keydown", key);
      el.removeEventListener("blur", blur);
      this.cache.delete(id);
      onDone();
    };
    el.addEventListener("input", input);
    el.addEventListener("keydown", key);
    el.addEventListener("blur", blur);
    return true;
  }

  private remember(html: string) {
    this.cache.clear();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.querySelectorAll(".om-l").forEach((el) => {
      const id = el.getAttribute("data-om-layer");
      const fx = el.querySelector(".om-fx");
      if (id && fx) this.cache.set(id, fx.innerHTML);
    });
    parsed.querySelectorAll("audio[data-om-id]").forEach((el) => this.cache.set(el.getAttribute("data-om-id")!, el.outerHTML));
  }
}

/** Anything that changes DOM structure forces a full reload. */
function signature(spec: MotionSpec): string {
  const order = spec.layers
    .map((l, i) => ({ l, i }))
    .filter((e) => !e.l.hidden)
    .sort((a, b) => a.l.track - b.l.track || a.i - b.i)
    .map((e) => [e.l.id, e.l.type, e.l.track]);
  return JSON.stringify([spec.canvas.width, spec.canvas.height, spec.style?.fonts ?? [], order, spec.transcript?.source ?? "", spec.transcript?.cuts ?? []]);
}
