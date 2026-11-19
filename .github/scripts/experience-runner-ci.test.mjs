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
