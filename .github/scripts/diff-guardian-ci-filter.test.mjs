// The AI reviewer workflows, their scripts and their tests must be selected by the `web` group of
// .github/filters/ci.yml, or a change to them would merge without the tests that guard them.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const patterns = YAML.parse(readFileSync('.github/filters/ci.yml', 'utf8')).web;

// Just enough of dorny/paths-filter's glob syntax for the entries used here: **, * and {a,b}.
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (char === '{') out += '(?:';
    else if (char === '}') out += ')';
    else if (char === ',') out += '|';
    else out += char.replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
const selected = (path) => patterns.some((pattern) => globToRegExp(pattern).test(path));
const filesIn = (dir) => readdirSync(dir).map((name) => `${dir}/${name}`);

test('every reviewer script, test and workflow is selected by the web filter', () => {
  const required = [
    '.github/workflows/diff-guardian.yml',
    '.github/workflows/gemini-code-review.yml',
    // The Diff Guardian contract test reads Muse's workflow and its renderer.
    '.github/workflows/muse-code-review.yml',
    '.github/scripts/muse-review/post.sh',
    '.github/scripts/muse-review/validate.jq',
    '.github/scripts/gemini-code-review-workflow.test.mjs',
    ...filesIn('.github/scripts/gemini-review'),
    ...filesIn('.github/scripts/diff-guardian'),
    ...readdirSync('.github/scripts').filter((name) => name.startsWith('diff-guardian-')).map((name) => `.github/scripts/${name}`),
  ];
  const missing = required.filter((path) => !selected(path));
  assert.deepEqual(missing, []);
});

test('Muse pin updates and the Jules workflow do not start the whole web suite', () => {
  assert.equal(selected('.github/scripts/muse-review/install.sh'), false);
  assert.equal(selected('.github/workflows/jules-pr-review.yml'), false);
});
