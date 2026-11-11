import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from '@typescript/typescript6';
import YAML from 'yaml';
import { decide, needsProductionTypecheck } from './production-build-typecheck-scope.mjs';

const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
function parse(name) {
  const source = ts.readConfigFile(`${web}${name}`, ts.sys.readFile);
  assert.equal(source.error, undefined);
  return ts.parseJsonConfigFileContent(source.config, ts.sys, web);
}
const isTest = path => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || /\/(?:__tests__|__mocks__)\//.test(path);

test('production typecheck retains every non-test root and strict compiler policy', () => {
  const full = parse('tsconfig.json');
  const build = parse('tsconfig.build.json');
  const productionRoots = new Set(build.fileNames);
  // The build regenerates .next/types/link.d.ts, so production reads the prepared copy instead.
  for (const file of full.fileNames.filter(path => !isTest(path) && !path.endsWith('/.next/types/link.d.ts'))) {
    assert.ok(productionRoots.has(file), `production source lost: ${file}`);
  }
  assert.equal(build.options.strict, true);
  assert.equal(build.options.noEmit, true);
  assert.equal(build.options.skipLibCheck, full.options.skipLibCheck);
  assert.deepEqual(build.options.paths, full.options.paths);
  assert.deepEqual(build.options.types, full.options.types);
  assert.notEqual(build.options.tsBuildInfoFile, full.options.tsBuildInfoFile);
});

test('production excludes the test graph while the normal typecheck still includes it', () => {
  const full = parse('tsconfig.json');
  const build = parse('tsconfig.build.json');
  assert.ok(full.fileNames.some(isTest), 'full CI typecheck must still cover tests');
  assert.equal(build.fileNames.filter(isTest).length, 0);
  assert.ok(build.fileNames.length < full.fileNames.length);
  const nextConfig = readFileSync(`${web}next.config.ts`, 'utf8');
  const buildConfig = readFileSync(`${web}src/config/build-typecheck.ts`, 'utf8');
  assert.match(nextConfig, /typescript: BUILD_TYPESCRIPT_CONFIG/);
  assert.match(buildConfig, /tsconfigPath: 'tsconfig\.build\.json',\s*ignoreBuildErrors: false,/);
  const manifest = JSON.parse(readFileSync(`${web}package.json`, 'utf8'));
  assert.match(manifest.scripts.typecheck, /tsc --noEmit/);
  assert.doesNotMatch(manifest.scripts.typecheck, /tsconfig\.build/);
});

test('production build checks the prepared typed-route declaration, not the one next build regenerates', () => {
  const build = JSON.parse(readFileSync(`${web}tsconfig.build.json`, 'utf8'));
  assert.ok(build.exclude.includes('.next/types/link.d.ts'));
  // `files` (not `include`) so a missing copy is TS6053 instead of silently unchecked routes;
  // `include` stays inherited so production cannot drift from the full typecheck roots.
  assert.deepEqual(build.files, ['.typed-navigation/link.d.ts']);
  assert.equal(build.include, undefined);
  const manifest = JSON.parse(readFileSync(`${web}package.json`, 'utf8'));
  // The copy comes from `next typegen`, where release-asset rewrites are empty; `next build` adds them.
  // That is equivalent only while those rewrites contribute no typed routes (pinned in
  // release-asset-rewrites.test.ts). A rewrite that expands into routes must be prepared at build time.
  assert.equal(
    manifest.scripts.build,
    'next typegen && node tools/prepare-typed-navigation.mjs --output .typed-navigation/link.d.ts && BACI_STOREFRONT_BUILD_READS=bounded NODE_ENV=production next build'
  );
  assert.doesNotMatch(manifest.scripts['build:ci'], /typegen/);
});

test('CI runs the production build type-check path after the normal typecheck', () => {
  const manifest = JSON.parse(readFileSync(`${web}package.json`, 'utf8'));
  // Same three steps as `build` before `next build`; build:ci skips type checking, so CI needs this.
  assert.equal(
    manifest.scripts['typecheck:build'],
    'next typegen && node tools/prepare-typed-navigation.mjs --output .typed-navigation/link.d.ts && tsc --noEmit --incremental false -p tsconfig.build.json'
  );
  // `--incremental false`: with a stale tsconfig.build.tsbuildinfo the compiler accepted an unprepared
  // declaration in under two seconds; the gate must re-check everything on every run.
  const prefix = ' && tsc --noEmit --incremental false -p tsconfig.build.json';
  assert.ok(manifest.scripts['typecheck:build'].endsWith(prefix));
  assert.ok(manifest.scripts.build.startsWith(`${manifest.scripts['typecheck:build'].slice(0, -prefix.length)} && `));
  const workflow = YAML.parse(readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs['quality-typecheck'].steps;
  const normal = steps.findIndex(step => step.name === 'Run Typecheck');
  const scope = steps.findIndex(step => step.name === 'Decide production build typecheck');
  const prod = steps.findIndex(step => step.name === 'Run production build typecheck');
  assert.ok(normal >= 0 && scope > normal && prod > scope, 'production build typecheck must follow the normal typecheck');
  assert.equal(steps[scope].id, 'production-typecheck-scope');
  assert.equal(steps[scope].run, 'node .github/scripts/production-build-typecheck-scope.mjs');
  assert.equal(steps[scope].env.BASE_SHA, '${{ github.event.pull_request.base.sha }}');
  assert.equal(steps[prod].if, "steps.production-typecheck-scope.outputs.run == 'true'");
  assert.equal(steps[prod].run, 'pnpm turbo typecheck:build --filter=@baci/web');
  assert.equal(steps[prod].env.GOMEMLIMIT, '6GiB', 'match the deploy build compiler memory budget');
  assert.equal(steps[prod]['timeout-minutes'], 15, 'a slow compiler abort must fail within the step, not the shared job budget');
  assert.equal(steps[prod]['continue-on-error'], undefined);
  assert.equal(steps[scope]['continue-on-error'], undefined);
  const turbo = JSON.parse(readFileSync(new URL('../../turbo.json', import.meta.url), 'utf8'));
  // Never replay a cached pass: the task's inputs cannot see workspace packages the web program imports.
  assert.deepEqual(turbo.tasks['typecheck:build'], { cache: false });
  // GOMEMLIMIT only budgets the native compiler: the web app must stay on TypeScript 7.
  assert.match(manifest.devDependencies.typescript, /^~7\./);
});

test('pull requests skip the production build typecheck only when nothing in the production program changed', () => {
  const list = files => () => files;
  const run = (files, baseSha = 'base') => decide({ baseSha, listChangedFiles: list(files) }).run;
  for (const file of [
    // The 2026-11-10 TS2589 site: source under the production program must always be checked.
    'apps/web/src/components/storefront/blocks/footer.tsx',
    'apps/web/src/app/page.tsx',
    'apps/web/package.json',
    'apps/web/tsconfig.build.json',
    'apps/web/next.config.ts',
    'apps/web/tools/prepare-typed-navigation.mjs',
    'apps/web/src/config/build-typecheck.ts',
    'packages/shared/src/index.ts',
    // tsconfig.build.json inherits `tests/typecheck/**` and only excludes test-pattern names.
    'apps/web/tests/typecheck/routes.tsx',
    'apps/web/tests/checkout-browser/contact.pw.ts',
    'pnpm-lock.yaml',
    '.npmrc',
    'package.json',
    'turbo.json',
    'tsconfig.base.json',
    '.github/workflows/ci.yml',
    '.github/actions/pnpm-install-cached/action.yml',
    '.github/scripts/production-build-typecheck-scope.mjs',
    '.github/scripts/production-typecheck-scope.test.mjs',
  ]) {
    assert.equal(needsProductionTypecheck([file]), true, file);
    assert.equal(run(['docs/x.md', file]), true, file);
  }
  for (const file of [
    'apps/web/src/app/page.test.tsx',
    'apps/web/src/lib/__tests__/helper.ts',
    'apps/web/src/lib/__mocks__/supabase.ts',
    'apps/web/README.md',
    'apps/mobile-admin/app/index.tsx',
    'docs/production-release-coordination.md',
    'supabase/migrations/20261111000000_x.sql',
  ]) {
    assert.equal(run([file]), false, file);
  }
  // The job itself only starts when the outer `web` filter matches, so a trigger that filter
  // cannot see would never take effect.
  const webFilter = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8')).web.flat(Infinity);
  for (const pattern of [
    'apps/web/**',
    'packages/shared/**',
    'packages/experience-sdk/**',
    'packages/tiktok-business/**',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    'turbo.json',
    'tsconfig*.json',
    '.github/workflows/ci.yml',
    '.github/actions/pnpm-install-cached/**',
    '.github/actions/setup-pnpm-store/**',
    '.github/scripts/production-build-typecheck-scope.mjs',
    '.github/scripts/production-typecheck-scope.test.mjs',
  ]) {
    assert.ok(webFilter.includes(pattern), `web filter must include ${pattern}`);
  }
  assert.equal(needsProductionTypecheck(['.github/actions/unlisted/action.yml']), false);
  // The scope treats every workspace package as production code; the job filter must see each one.
  const packages = readdirSync(new URL('../../packages/', import.meta.url), { withFileTypes: true });
  for (const entry of packages.filter(entry => entry.isDirectory())) {
    assert.ok(webFilter.includes(`packages/${entry.name}/**`), `web filter must include packages/${entry.name}/**`);
  }
  const scopeScript = readFileSync(new URL('./production-build-typecheck-scope.mjs', import.meta.url), 'utf8');
  assert.match(scopeScript, /'--name-only', '-z'/, 'paths must be read unquoted');
  assert.match(scopeScript, /\.split\('\\0'\)/);
  // Fail closed: pushes, an unreadable diff, and an empty diff all run the check.
  assert.equal(run(['docs/x.md'], ''), true);
  assert.equal(run([]), true);
  assert.equal(decide({ baseSha: 'base', listChangedFiles: () => { throw new Error('git failed'); } }).run, true);
});

test('production budgets the native Go compiler without changing the full CI typecheck', () => {
  const workflow = YAML.parse(readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8'));
  const build = workflow.jobs['deploy-production'].steps.find(step => step.name === 'Build for Vercel');
  assert.equal(build.env.GOMEMLIMIT, '6GiB');
  const turbo = JSON.parse(readFileSync(new URL('../../turbo.json', import.meta.url), 'utf8'));
  assert.ok(turbo.globalPassThroughEnv.includes('GOMEMLIMIT'), 'strict Turbo must forward GOMEMLIMIT to the compiler');
  assert.equal(build['continue-on-error'], undefined);
});
