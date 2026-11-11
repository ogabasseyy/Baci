import { readFileSync } from 'node:fs';

// A step that only calls `bash .github/scripts/<name>.sh` keeps its logic in that script, so check the script.
export function scriptText(step) {
  const call = /^bash (\.github\/scripts\/[\w.-]+\.sh)$/.exec(typeof step.run === 'string' ? step.run.trim() : '');
  return call ? readFileSync(call[1], 'utf8') : step.run;
}
