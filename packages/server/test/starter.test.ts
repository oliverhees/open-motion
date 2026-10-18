import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMATS, STYLES, validateSpec } from "@openmotion/core";
import { blankSpec } from "../src/store.ts";

// The browser check (scripts/starter-fit.ts) measures real fonts; this guards the layout math without Chrome.
test("starter: every style × format × language is valid, the headline fits its width and the subtitle sits below it", () => {
  for (const st of STYLES) for (const f of FORMATS) for (const lang of ["de", "en"] as const) {
    const spec = blankSpec(lang, { format: f, style: st.id });
    const where = `${st.id} ${f} ${lang}`;
    assert.equal(validateSpec(spec).ok, true, where);
    const title = spec.layers.find((l) => l.id === "title")!;
    const sub = spec.layers.find((l) => l.id === "sub")!;
    if (title.type !== "text" || sub.type !== "text") throw new Error(where);
    const size = title.style!.fontSize!;
    const longest = Math.max(...title.text.replace(/\[\[|\]\]/g, "").split("\n").map((l) => l.length));
    assert.ok(longest * size * (st.fonts.displayWidth ?? 0.75) <= title.frame.w, `${where}: headline too wide`);
    assert.ok(sub.frame.y >= title.frame.y + title.frame.h, `${where}: subtitle overlaps the headline`);
    assert.ok(sub.frame.y + sub.frame.h <= spec.canvas.height, `${where}: subtitle below the canvas`);
  }
});
