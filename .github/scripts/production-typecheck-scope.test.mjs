import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from '@typescript/typescript6';
import YAML from 'yaml';

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

test('production budgets the native Go compiler without changing the full CI typecheck', () => {
  const workflow = YAML.parse(readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8'));
  const build = workflow.jobs['deploy-production'].steps.find(step => step.name === 'Build for Vercel');
  assert.equal(build.env.GOMEMLIMIT, '6GiB');
  const turbo = JSON.parse(readFileSync(new URL('../../turbo.json', import.meta.url), 'utf8'));
  assert.ok(turbo.globalPassThroughEnv.includes('GOMEMLIMIT'), 'strict Turbo must forward GOMEMLIMIT to the compiler');
  assert.equal(build['continue-on-error'], undefined);
});
