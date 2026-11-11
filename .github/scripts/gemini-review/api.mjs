// One Gemini generateContent request per review: no agent loop, no tools, no web access.
// Every failure is classified so the workflow can tell "Gemini found a problem" (blocking)
// apart from "Gemini could not review" (quota, outage, bad config: never blocking).
import { REVIEW_SCHEMA } from './schema.mjs';

export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Thinking tokens count against maxOutputTokens, so leave room for both.
const MAX_OUTPUT_TOKENS = 12288;
const MAX_RETRY_WAIT_MS = 30_000;
const UNAVAILABLE_BACKOFF_MS = [5000, 15000];
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,62}$/;

export function thinkingConfigFor(model) {
  // The 2.5 family takes a token budget; newer models take a level.
  return /^gemini-2\.5/.test(model) ? { thinkingBudget: 1024 } : { thinkingLevel: 'low' };
}

export function buildRequest({ prompt, model }) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: REVIEW_SCHEMA,
      thinkingConfig: thinkingConfigFor(model),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };
}

/** "5s" / "2.33s" -> milliseconds, or null when absent or unreadable. */
export function parseRetryDelayMs(value) {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value ?? ''));
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

export function classifyHttpFailure(status, body) {
  const error = body?.error ?? {};
  const detail = String(error.message ?? '').slice(0, 300);
  const details = Array.isArray(error.details) ? error.details : [];
  if (status === 429) {
    const quotaIds = details.flatMap((entry) => (entry.violations ?? []).map((v) => String(v.quotaId ?? v.quotaMetric ?? '')));
    const retryInfo = details.find((entry) => String(entry['@type'] ?? '').endsWith('RetryInfo'));
    const retryAfterMs = parseRetryDelayMs(retryInfo?.retryDelay);
    const daily = quotaIds.some((id) => /PerDay/i.test(id)) || (retryAfterMs !== null && retryAfterMs > MAX_RETRY_WAIT_MS);
    return { kind: daily ? 'quota_daily' : 'quota_rate', retryAfterMs, detail };
  }
  if (status === 401 || status === 403) return { kind: 'auth', detail };
  if (status === 404) return { kind: 'model_not_found', detail };
  if (status === 400) {
    return { kind: /api key not valid|API_KEY_INVALID/i.test(`${detail} ${JSON.stringify(details)}`) ? 'auth' : 'bad_request', detail };
  }
  if (status === 408 || status >= 500) return { kind: 'unavailable', detail };
  return { kind: 'unknown', detail };
}

function interpretAnswer(json, model) {
  const candidate = json?.candidates?.[0];
  if (json?.promptFeedback?.blockReason && !candidate) {
    return { ok: false, kind: 'blocked', detail: `prompt blocked: ${json.promptFeedback.blockReason}` };
  }
  const finish = candidate?.finishReason;
  if (finish && finish !== 'STOP') return { ok: false, kind: 'incomplete', detail: `finishReason ${finish}` };
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
  if (!text.trim()) return { ok: false, kind: 'empty', detail: 'the answer had no text' };
  const usage = json.usageMetadata ?? {};
  return {
    ok: true,
    text,
    model: json.modelVersion ?? model,
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      thoughtTokens: usage.thoughtsTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? 0,
    },
  };
}

async function requestOnce({ fetchImpl, url, apiKey, body, timeoutMs, model }) {
  let response;
  let raw;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await response.text();
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return timedOut
      ? { ok: false, kind: 'timeout', detail: `no answer within ${Math.round(timeoutMs / 1000)}s` }
      : { ok: false, kind: 'unavailable', detail: 'network error' };
  }
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Keep json null: a non-JSON body is classified by status alone.
  }
  if (response.status !== 200) return { ok: false, ...classifyHttpFailure(response.status, json) };
  return interpretAnswer(json, model);
}

function retryWaitMs(failure, attempt) {
  if (failure.kind === 'quota_rate') return Math.min((failure.retryAfterMs ?? 10_000) + 1000, MAX_RETRY_WAIT_MS);
  if (failure.kind === 'unavailable' || failure.kind === 'timeout') {
    return UNAVAILABLE_BACKOFF_MS[attempt - 1] ?? UNAVAILABLE_BACKOFF_MS.at(-1);
  }
  return null;
}

export async function callGemini({
  fetchImpl = fetch,
  apiKey,
  model,
  prompt,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  baseUrl = BASE_URL,
  timeoutMs = 100_000,
  maxAttempts = 3,
}) {
  if (!MODEL_PATTERN.test(String(model))) {
    return { ok: false, kind: 'bad_request', detail: 'invalid model name', attempts: 0 };
  }
  const url = `${baseUrl}/models/${model}:generateContent`;
  const body = JSON.stringify(buildRequest({ prompt, model }));
  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = { ...(await requestOnce({ fetchImpl, url, apiKey, body, timeoutMs, model })), attempts: attempt };
    const wait = result.ok ? null : retryWaitMs(result, attempt);
    if (wait === null || attempt === maxAttempts) break;
    await sleep(wait);
  }
  return result;
}
