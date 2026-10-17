import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPatch, type MotionSpec } from "@openmotion/core";
import { aspectFor, extractJson, fromGemini, fromOpenRouter, generateImage, runAgent, systemPrompt, type Settings } from "@openmotion/server";

const root = path.resolve(import.meta.dirname, "../../..");
const example = JSON.parse(readFileSync(path.join(root, "examples/explainer/spec.json"), "utf8")) as MotionSpec;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
const base: Settings = { transcription: { provider: "local", language: "de", models: {} }, ai: { provider: "anthropic" }, images: { provider: "openai" }, keys: { anthropic: "sk-ant-test", openai: "sk-test", kie: "kie-test", gemini: "g-test", openrouter: "or-test" } };

/** Fake fetch: answers with queued responses and records every request. */
function fakeFetch(answers: ((url: string, init?: RequestInit) => unknown)[]) {
  const calls: { url: string; body?: any; headers?: any }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    const out = next(String(url), init);
    if (out instanceof Uint8Array) return new Response(out);
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}
const claude = (obj: unknown, chatter = "") => () => ({ content: [{ type: "text", text: `${chatter}\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` }] });

test("comment → patch: invalid answer is sent back with the exact error, second answer wins", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
  const { f, calls } = fakeFetch([
    claude({ message: "x", ops: [{ op: "set", id: "tasse", path: "frame.rotation", value: 5 }] }),
    claude({ message: "Schloss gedreht.", ops: [{ op: "set", id: "s1-icon", path: "frame.rotation", value: 5 }] }, "Klar! "),
  ]);
  const r = await runAgent({ kind: "comment", spec: example, comment: { t: 2, layer: "s1-icon", text: "dreh das Schloss etwas" } }, { settings: base, projectDir: dir, fetch: f });
  assert.equal(r.attempts, 2);
  assert.deepEqual(r.changed, ["s1-icon"]);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], "sk-ant-test");
  assert.equal(calls[0].body.model, "claude-sonnet-5-5");
  assert.match(calls[0].body.messages[0].content, /AUSGEWÄHLTE EBENE[\s\S]*"id":"s1-icon"/);
  assert.match(calls[1].body.messages.at(-1).content, /no layer with id "tasse"/);
});

test("chat: ai: image prompts become real files, only after the patch is valid", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
  const { f, calls } = fakeFetch([
    claude({ message: "Bild ergänzt.", ops: [{ op: "add", layer: { id: "see", type: "image", track: 9, start: 0, duration: 3, frame: { x: 100, y: 100, w: 640, h: 360 }, src: "ai:calm mountain lake at sunrise, flat illustration" } }] }),
    () => ({ data: [{ b64_json: PNG }] }),
  ]);
  const r = await runAgent({ kind: "chat", spec: example, messages: [{ role: "user", text: "Füg ein Bild von einem Bergsee ein" }] }, { settings: base, projectDir: dir, fetch: f });
  const layer = (r.ops[0] as any).layer;
  assert.match(layer.src, /^assets\/images\/ki-calm-mountain-lake-at-sunrise-[a-z-]*[0-9a-f]{4}\.png$/);
  assert.deepEqual(layer.source, { kind: "ai", prompt: "calm mountain lake at sunrise, flat illustration", model: "openai:gpt-image-1" });
  assert.ok(existsSync(path.join(dir, layer.src)));
  assert.equal(calls[1].url, "https://api.openai.com/v1/images/generations");
  assert.equal(calls[1].body.size, "1536x1024");
  assert.ok(applyPatch(example, r.ops).spec.layers.some((l) => l.id === "see"));
});

test("missing key: clear message, no retries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
  await assert.rejects(runAgent({ kind: "chat", spec: example, messages: [{ role: "user", text: "hi" }] }, { settings: { ...base, keys: {} }, projectDir: dir }), /Kein API-Key für Anthropic/);
});

test("OpenAI and OpenRouter chat formats", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
  const ok = { message: "ok", ops: [] };
  for (const provider of ["openai", "openrouter"] as const) {
    const { f, calls } = fakeFetch([() => ({ choices: [{ message: { content: JSON.stringify(ok) } }] })]);
    const r = await runAgent({ kind: "transcript", spec: example }, { settings: { ...base, ai: { provider } }, projectDir: dir, fetch: f });
    assert.equal(r.message, "ok");
    assert.equal(calls[0].body.messages[0].role, "system");
    assert.match(calls[0].body.messages[1].content, /GESAGTES[\s\S]*w22@10\.42 image\./);
    assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  }
});

test("Kie.ai: createTask → poll → download", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
  const { f, calls } = fakeFetch([
    () => ({ code: 200, data: { taskId: "t1" } }),
    () => ({ data: { state: "generating" } }),
    () => ({ data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/x/result.png"] }) } }),
    () => Buffer.from(PNG, "base64"),
  ]);
  const img = await generateImage({ ...base, images: { provider: "kie" } }, "a lake", "16:9", dir, f, async () => {});
  assert.equal(calls[0].body.model, "gpt-image-2-text-to-image");
  assert.deepEqual(calls[0].body.input, { prompt: "a lake", aspect_ratio: "16:9" });
  assert.equal(calls[0].headers.authorization, "Bearer kie-test");
  assert.match(calls[1].url, /recordInfo\?taskId=t1/);
  assert.ok(existsSync(path.join(dir, img.path)));
});

test("Gemini and OpenRouter image answers", async () => {
  assert.equal(fromGemini({ candidates: [{ content: { parts: [{ text: "hier" }, { inlineData: { mimeType: "image/png", data: PNG } }] } }] }).data, PNG);
  assert.equal(fromOpenRouter({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }] }), `data:image/png;base64,${PNG}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "om-ai-"));
  const { f, calls } = fakeFetch([() => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG } }] } }] })]);
  await generateImage({ ...base, images: { provider: "gemini" } }, "x", "9:16", dir, f);
  assert.match(calls[0].url, /gemini-2\.5-flash-image:generateContent$/);
  assert.equal(calls[0].body.generationConfig.imageConfig.aspectRatio, "9:16");
  assert.equal(aspectFor(1920, 1080), "16:9");
  assert.equal(aspectFor(400, 420), "1:1");
});

test("helpers: JSON extraction, prompt knows the canvas and palette", () => {
  assert.deepEqual(extractJson('Hier:\n```json\n{"message":"a","ops":[]}\n```\nfertig'), { message: "a", ops: [] });
  assert.throws(() => extractJson("nope"), /kein JSON/);
  const p = systemPrompt(example);
  assert.match(p, /1920×1080 px/);
  assert.match(p, /\$accent/);
});
