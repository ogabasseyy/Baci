import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

// Vitest never runs Playwright specs. Their validation is the browser workflow,
// so it must really run for every pull request and cover every spec folder that
// the planner targets. experience-browser has no pull request workflow today; it
// was already targeted-only before this planner change.
test('every Playwright spec folder is run by the browser workflow on every pull request, or is listed as having none', () => {
  const browser = YAML.parse(
    readFileSync('.github/workflows/checkout-browser.yml', 'utf8')
  );
  const trigger = browser.on ?? browser[true];
  const commands = Object.values(browser.jobs)
    .flatMap((job) => job.steps)
    .map((step) => step.run ?? '')
    .join('\n');

  assert.ok(
    trigger.pull_request,
    'checkout-browser.yml must run on pull_request'
  );
  assert.equal(trigger.pull_request.paths, undefined);
  assert.equal(trigger.pull_request['paths-ignore'], undefined);
  assert.match(commands, /test:checkout:browser/);
  assert.match(
    commands,
    /tests\/oxygen-policy-browser\/playwright\.config\.ts/
  );
  assert.match(
    commands,
    /tests\/oxygen-cookie-harness\/playwright\.config\.ts/
  );

  const covered = new Set([
    'apps/web/tests/checkout-browser',
    'apps/web/tests/oxygen-policy-browser',
    'apps/web/tests/oxygen-cookie-harness',
  ]);
  const NO_PULL_REQUEST_WORKFLOW = new Set([
    'apps/web/tests/experience-browser',
  ]);
  // Filtered in Node, not with a git pathspec, so the result cannot depend on how
  // git expands `**`; the checks below fail if the list ever comes back empty.
  const folders = new Set(
    execFileSync('git', ['ls-files', 'apps/web'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((file) => file.endsWith('.pw.ts'))
      .map((file) => file.split('/').slice(0, 4).join('/'))
  );
  assert.ok(
    folders.size > 0,
    'found no Playwright spec: the enumeration broke'
  );
  for (const folder of [...covered, ...NO_PULL_REQUEST_WORKFLOW]) {
    assert.ok(
      folders.has(folder),
      `${folder} no longer holds Playwright specs: drop it from this list`
    );
  }
  for (const folder of folders) {
    assert.ok(
      covered.has(folder) || NO_PULL_REQUEST_WORKFLOW.has(folder),
      `${folder} holds Playwright specs that no pull request workflow runs: add it to checkout-browser.yml`
    );
  }
});
