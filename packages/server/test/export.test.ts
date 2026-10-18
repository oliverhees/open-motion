import { test } from "node:test";
import assert from "node:assert/strict";
import { blankSpec } from "../src/store.ts";
import { exportName, sanitize, withDefaults } from "../src/jobs.ts";

test("export request: new formats, transparency only where it exists, background hidden by default, names per format", () => {
  assert.equal(sanitize({ format: "exe" as never }).format, "mp4");
  assert.equal(sanitize({ format: "mp4", transparent: true }).transparent, false, "MP4 has no alpha");
  assert.equal(sanitize({ format: "webm" }).transparent, true);
  assert.equal(sanitize({ format: "mov", transparent: false }).transparent, false);
  assert.deepEqual(sanitize({ format: "webm", hide: ["a", 3 as never, "x".repeat(200)] }).hide, ["a"], "only sane ids");
  const spec = blankSpec("de", { format: "9:16", style: "neon" });
  assert.deepEqual(withDefaults(sanitize({ format: "webm" }), spec).hide, ["bg"]);
  assert.deepEqual(withDefaults(sanitize({ format: "webm", hide: [] }), spec).hide, [], "explicit choice wins");
  assert.equal(withDefaults(sanitize({ format: "mp4" }), spec).hide, undefined);
  assert.match(exportName("p", sanitize({ format: "lottie" }), "S"), /^p-lottie-S\.json$/);
  assert.match(exportName("p", sanitize({ format: "mov", height: 720 }), "S"), /^p-720p-alpha-S\.mov$/);
  assert.match(exportName("p", sanitize({ format: "mp4" }), "S"), /^p-1080p-S\.mp4$/);
});
