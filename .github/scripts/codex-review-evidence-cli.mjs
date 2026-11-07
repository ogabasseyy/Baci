import { readFileSync, statSync } from 'node:fs';
import { classifyCodexReview, isCodexAppComment } from './codex-review-evidence.mjs';

const [first, second] = process.argv.slice(2);
const projecting = first === '--project';
const file = projecting ? second : first;
const head = projecting ? undefined : second;
if (!file || (!projecting && !head) || statSync(file).size > 5_000_000) {
  throw new Error('Missing or oversized comment response');
}
const pages = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
  throw new Error('Unexpected paginated comment response');
}
const comments = pages.flat();
const result = projecting
  ? JSON.stringify(comments.filter(isCodexAppComment).map((item) => [item.id, item.updated_at, item.body]))
  : classifyCodexReview(comments, head);
process.stdout.write(`${result}\n`);
