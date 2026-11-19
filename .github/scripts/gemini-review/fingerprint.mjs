// A fingerprint of what a pull request CHANGES, independent of where it sits in the file.
// A merge from main shifts hunk offsets and blob ids and changes the context lines, but not the
// added and removed lines, so it keeps the same fingerprint and the review can be skipped.
import { createHash } from 'node:crypto';
import { isMain } from './cli.mjs';

const HEADER_PREFIXES = [
  'diff --git ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
  'new file mode ',
  'deleted file mode ',
  'old mode ',
  'new mode ',
  'Binary files ',
  'GIT binary patch',
];

export function diffFingerprint(diff) {
  const kept = [];
  let inHunk = false;
  for (const raw of String(diff ?? '').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      kept.push(line);
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk) {
      // Inside a hunk every +/- line is content, even one that starts with "+++ " or "--- ".
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith('\\')) kept.push(line);
    } else if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      kept.push(line);
    }
  }
  if (kept.length === 0) return '';
  return createHash('sha256').update(kept.join('\n')).digest('hex');
}

if (isMain(import.meta.url)) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(`${diffFingerprint(Buffer.concat(chunks).toString('utf8'))}\n`);
}
