import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const start = '<!-- draft-first-policy:start -->';
const end = '<!-- draft-first-policy:end -->';
function policy(path) {
  const text = readFileSync(path, 'utf8');
  assert.equal(text.split(start).length, 2, `${path}: one policy start`);
  assert.equal(text.split(end).length, 2, `${path}: one policy end`);
  return text.split(start)[1].split(end)[0];
}

describe('draft-first agent policy stays synchronized', () => {
  for (const path of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', 'docs/runbooks/review-first-ci.md']) {
    it(`${path} matches the authoritative Ruler source`, () => {
      assert.equal(policy(path), policy('.ruler/AGENTS.md'));
    });
  }
});
