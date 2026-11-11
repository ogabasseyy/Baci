// Sends the prepared prompt to Gemini once and records what happened. This step holds the
// Gemini key and NO GitHub token. It never fails the job: the post step turns the recorded
// outcome into a status (a model that could not answer is "error", not "failure").
// Env in: GEMINI_API_KEY, GEMINI_MODEL (optional), PROMPT_FILE, RESPONSE_FILE, GITHUB_OUTPUT.
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_MODEL, callGemini } from './api.mjs';
import { isMain, setOutputs } from './cli.mjs';

export async function run({ env, fetchImpl = fetch, sleep, log = console.log }) {
  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  let result;
  let prompt = '';
  try {
    prompt = readFileSync(env.PROMPT_FILE, 'utf8');
  } catch {
    // Reported below; the message never includes file contents.
  }
  if (!env.GEMINI_API_KEY) {
    result = { ok: false, kind: 'auth', detail: 'GEMINI_API_KEY is not set', attempts: 0 };
  } else if (!prompt.trim()) {
    result = { ok: false, kind: 'bad_request', detail: 'the prompt file is missing or empty', attempts: 0 };
  } else {
    result = await callGemini({ fetchImpl, apiKey: env.GEMINI_API_KEY, model, prompt, sleep });
  }
  writeFileSync(env.RESPONSE_FILE, JSON.stringify({ ...result, requestedModel: model }));
  if (result.ok) {
    const { promptTokens, outputTokens, thoughtTokens } = result.usage;
    log(`::notice::Gemini (${result.model}) answered in ${result.attempts} attempt(s): ${promptTokens} prompt, ${outputTokens + thoughtTokens} output tokens.`);
  } else {
    log(`::warning::Gemini could not review (${result.kind}, ${result.attempts} attempt(s)): ${result.detail}`);
  }
  setOutputs(env, { outcome: result.ok ? 'ok' : result.kind });
  return result;
}

if (isMain(import.meta.url)) await run({ env: process.env });
