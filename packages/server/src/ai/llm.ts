import { httpFetch } from "../http.ts";
// Language models with your own key: Anthropic (Claude), OpenAI, OpenRouter.
import { DEFAULT_LLM_MODELS, type LlmProvider, type Settings } from "../settings.ts";

export interface Msg { role: "user" | "assistant"; content: string }
export type Fetch = typeof fetch;

const LABEL: Record<LlmProvider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", openrouter: "OpenRouter" };

export async function complete(settings: Settings, system: string, messages: Msg[], f: Fetch = httpFetch, maxTokens = 8000): Promise<string> {
  const provider = settings.ai.provider;
  const model = settings.ai.model || DEFAULT_LLM_MODELS[provider];
  const key = settings.keys[provider];
  if (!key) throw new Error(`Kein API-Key für ${LABEL[provider]}. Trag ihn unter ⚙ Einstellungen ein.`);
  if (provider === "anthropic") {
    const j = await call(f, "https://api.anthropic.com/v1/messages", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: { model, max_tokens: maxTokens, system, messages },
    }, provider) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  }
  const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  if (provider === "openrouter") Object.assign(headers, { "HTTP-Referer": "https://github.com/openmotion", "X-Title": "OpenMotion" });
  const j = await call(f, url, {
    headers,
    body: { model, messages: [{ role: "system", content: system }, ...messages], response_format: { type: "json_object" }, ...(provider === "openai" ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) },
  }, provider) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

async function call(f: Fetch, url: string, init: { headers: Record<string, string>; body: unknown }, provider: LlmProvider): Promise<unknown> {
  const r = await f(url, { method: "POST", headers: init.headers, body: JSON.stringify(init.body), signal: AbortSignal.timeout(5 * 60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${LABEL[provider]} antwortet mit ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

/** Pulls the first JSON object out of a model answer (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Die Antwort enthält kein JSON-Objekt.");
  return JSON.parse(body.slice(start, end + 1));
}
