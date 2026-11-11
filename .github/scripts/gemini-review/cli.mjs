// Small helpers shared by the step programs (decide, call, post).
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when the module is the program being run (not imported by a test). */
export const isMain = (moduleUrl) => Boolean(process.argv[1]) && moduleUrl === pathToFileURL(process.argv[1]).href;

/** Appends single-line `key=value` outputs for the next workflow steps. */
export function setOutputs(env, values) {
  if (!env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) {
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${String(value).replace(/[\r\n]+/g, ' ')}\n`);
  }
}

export const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
