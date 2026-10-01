import { MAX_JSONL_ROTATED_FILES } from './vercel-error-events-limits.mjs';
import { readDrainTail } from './vercel-error-events-tail.mjs';

export function readJsonlLogEvents(
  path,
  { maxRotatedFiles = MAX_JSONL_ROTATED_FILES, reader = readDrainTail } = {}
) {
  const parsedLimit = Number(maxRotatedFiles);
  const effectiveLimit =
    Number.isSafeInteger(parsedLimit) && parsedLimit > 0
      ? parsedLimit
      : MAX_JSONL_ROTATED_FILES;
  const content = reader(path, effectiveLimit);
  const events = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `Invalid JSONL at ${path} (tail line ${index + 1}): ${error.message}`
      );
    }
  }
  return events;
}
