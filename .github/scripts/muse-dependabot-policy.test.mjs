import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync('.github/dependabot.yml', 'utf8');
const actionsEntry = config
  .split(/^  - package-ecosystem:/m)
  .find((entry) => /^\s*"github-actions"\s*$/m.test(entry));

test('excludes only the audited Muse workflow from automated action updates', () => {
  assert.ok(actionsEntry, 'GitHub Actions updater must remain enabled');
  assert.match(actionsEntry, /^    directory: "\/"$/m);
  assert.match(
    actionsEntry,
    /^    exclude-paths:\n      - "\.github\/workflows\/muse-code-review\.yml"\n(?=    \S)/m
  );
  assert.doesNotMatch(actionsEntry, /dependency-name:\s*["']?actions\/checkout/);
  assert.match(actionsEntry, /^    groups:\n      ci-actions-minor:/m);
});

test('runs the pin-policy regression when updater policy changes', () => {
  const selftest = readFileSync('.github/workflows/muse-review-selftest.yml', 'utf8');
  assert.equal(
    selftest.match(/- '\.github\/dependabot\.yml'/g)?.length,
    2
  );
  assert.match(
    selftest,
    /static\)[\s\S]*node --test \.github\/scripts\/muse-dependabot-policy\.test\.mjs/
  );
});
