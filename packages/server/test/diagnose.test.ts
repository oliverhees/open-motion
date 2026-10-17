import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, formatReport, type Settings } from "@openmotion/server";

test("diagnose: tiny calls per key, model check with suggestions, report without keys", async () => {
  const settings: Settings = {
    transcription: { provider: "local", language: "de", models: {} },
    ai: { provider: "openai", model: "gpt-4-uralt" },
    images: { provider: "kie" },
    keys: { anthropic: "sk-ant-geheim-1111", openai: "sk-geheim-2222", kie: "kie-geheim-3333" },
  };
  const seen: string[] = [];
  const f = (async (url: string) => {
    seen.push(String(url));
    const u = String(url);
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    if (u.includes("anthropic.com/v1/messages")) return ok({ content: [{ type: "text", text: '{"ok":true}' }] });
    if (u.includes("openai.com/v1/chat/completions")) return new Response('{"error":{"message":"The model `gpt-4-uralt` does not exist","code":"model_not_found"}}', { status: 404 });
    if (u.includes("openai.com/v1/models")) return ok({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }, { id: "whisper-1" }] });
    if (u.includes("kie.ai/api/v1/chat/credit")) return ok({ code: 200, data: 1234 });
    throw new Error(`unerwartet: ${u}`);
  }) as typeof fetch;
  const checks = await diagnose(settings, { fetch: f });
  const by = (n: string) => checks.find((c) => c.name.startsWith(n))!;
  assert.equal(by("Anthropic").ok, true);
  assert.equal(by("OpenAI (aktiv)").ok, false);
  assert.match(by("OpenAI (aktiv)").hint!, /gpt-5-mini, gpt-5/);
  assert.equal(by("OpenRouter").ok, null);
  assert.match(by("Kie.ai").detail, /Guthaben: 1234/);
  const report = formatReport(checks, settings);
  assert.doesNotMatch(report, /geheim/);
  assert.match(report, /anthropic …1111/);
  assert.match(report, /✗ \[KI\] OpenAI \(aktiv\)/);
});
