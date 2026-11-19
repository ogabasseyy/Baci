import { readFileSync, statSync } from 'node:fs';
import { classifyCodexReview, isCodexAppComment } from './codex-review-evidence.mjs';

const [first, second, third] = process.argv.slice(2);
const projecting = first === '--project';
const file = projecting ? second : first;
const head = projecting ? undefined : second;
const eventsFile = projecting ? undefined : third;
if (!file || (!projecting && !head) || statSync(file).size > 5_000_000) {
  throw new Error('Missing or oversized comment response');
}
const pages = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
  throw new Error('Unexpected paginated comment response');
}
let invalidatedAt;
if (eventsFile) {
  if (statSync(eventsFile).size > 5_000_000) {
    throw new Error('Oversized event response');
  }
  const eventPages = JSON.parse(readFileSync(eventsFile, 'utf8'));
  if (!Array.isArray(eventPages) || !eventPages.every(Array.isArray)) {
    throw new Error('Unexpected paginated event response');
  }
  for (const event of eventPages.flat()) {
    if (event?.event === 'base_ref_changed' && typeof event.created_at === 'string') {
      if (!invalidatedAt || Date.parse(event.created_at) > Date.parse(invalidatedAt)) {
        invalidatedAt = event.created_at;
      }
    }
  }
}
const comments = pages.flat();
const result = projecting
  ? JSON.stringify(comments.filter(isCodexAppComment).map((item) => [item.id, item.updated_at, item.body]))
  : classifyCodexReview(comments, head, { invalidatedAt });
process.stdout.write(`${result}\n`);
