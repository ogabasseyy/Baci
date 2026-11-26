import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { resolveCiTestPlan } from './resolve-ci-test-plan.mjs';
const workflow = parse(readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'));
test('portable experience units are in the existing required non-sharded web job', () => {
  const job = workflow.jobs['quality-test'];
  const steps = job.steps.filter(s=>s.run === 'pnpm --filter @baci/web test:experience:runner');
  assert.equal(steps.length, 1);
  assert.equal(job.strategy, undefined);
  assert.equal(steps[0]['continue-on-error'], undefined);
  assert.equal(steps[0].if, "steps.test-plan.outputs.mode != 'config-smoke'");
  assert.ok(workflow.jobs.quality.needs.includes('quality-test'));
  assert.equal(workflow.jobs['quality-test-web'].steps.filter(s=>s.run?.includes('test:experience:runner')).length,0);
});
test('installs the locked Chromium shell before running the portable suite', () => {
  const steps = workflow.jobs['quality-test'].steps;
  const browser = steps.findIndex(
    (step) => step.run === 'pnpm --filter @baci/web exec playwright install --only-shell chromium'
  );
  const sandbox = steps.findIndex(
    (step) => step.name === 'Allow Chromium sandbox user namespaces on Ubuntu 24.04'
  );
  const runner = steps.findIndex(
    (step) => step.run === 'pnpm --filter @baci/web test:experience:runner'
  );
  assert.ok(browser >= 0 && browser < sandbox && sandbox < runner);
  assert.equal(steps[browser].if, steps[runner].if);
  assert.equal(
    steps[sandbox].if,
    `${steps[runner].if} && runner.environment == 'github-hosted'`
  );
});
test('only full CI downloads and verifies Caddy for the HTTPS test', () => {
  const steps = workflow.jobs.changes.steps;
  const ingress = steps.findIndex(
    (step) => step.run === 'bash apps/builder-execution-proxy/ci-ingress.sh'
  );
  const cosign = steps.findIndex((step) => step.uses?.startsWith('sigstore/cosign-installer@'));
  assert.ok(cosign > steps.findIndex((step) => step.id === 'stage_review'));
  assert.ok(ingress > cosign);
  assert.equal(steps[ingress].if, "(steps.stage_review.outputs.stage || steps.stage_full.outputs.stage) == 'full'");
  assert.equal(steps[cosign].if, steps[ingress].if);
});
for (const file of ['apps/web/tools/experience-runner/bundle-source.ts','apps/web/vitest.experience-runner.config.ts','apps/web/experience-runtime/bootstrap.tsx','apps/web/tests/experience-browser/qualification.pw.ts']) {
  test(`runner/runtime change selects web tests: ${file}`, () => {
    const plan=resolveCiTestPlan({ baseRef:'origin/main', changedFiles:[file], eventName:'pull_request' });
    assert.ok(['full-affected','targeted-web-vitest'].includes(plan.mode));
  });
}
test('SDK package changes select full affected consumers and non-web tests retain the SDK', async()=>{
 const plan=resolveCiTestPlan({baseRef:'origin/main',changedFiles:['packages/experience-sdk/src/channel.ts'],eventName:'pull_request'});
 assert.equal(plan.mode,'full-affected');
 const {resolveNonWebTestFilterArgs}=await import('./resolve-ci-non-web-test-filters.mjs');assert.deepEqual(resolveNonWebTestFilterArgs({baseRef:'origin/main',eventName:'pull_request'}),['--filter=...[origin/main]','--filter=!@baci/web']);
});
test('SDK-only changes select the existing web consumer gate through the actual paths filter',()=>{
 const filters=parse(readFileSync(new URL('../filters/ci.yml',import.meta.url),'utf8'));
 assert.ok(filters.web.includes('packages/experience-sdk/**'));
});
test('experience CI contract changes select their own required web validation',()=>{
 const file='.github/scripts/experience-runner-ci.test.mjs';
 const filters=parse(readFileSync(new URL('../filters/ci.yml',import.meta.url),'utf8'));
 assert.ok(filters.web.includes(file));
 assert.equal(resolveCiTestPlan({baseRef:'origin/main',changedFiles:[file],eventName:'pull_request'}).mode,'full-affected');
});
