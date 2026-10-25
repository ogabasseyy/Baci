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
  for (const file of full.fileNames.filter(path => !isTest(path))) {
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
  assert.match(nextConfig, /typescript:\s*\{\s*tsconfigPath: 'tsconfig\.build\.json',\s*ignoreBuildErrors: false,/);
  const manifest = JSON.parse(readFileSync(`${web}package.json`, 'utf8'));
  assert.match(manifest.scripts.typecheck, /tsc --noEmit/);
  assert.doesNotMatch(manifest.scripts.typecheck, /tsconfig\.build/);
});

test('production budgets the native Go compiler without changing the full CI typecheck', () => {
  const workflow = YAML.parse(readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8'));
  const build = workflow.jobs['deploy-production'].steps.find(step => step.name === 'Build for Vercel');
  assert.equal(build.env.GOMEMLIMIT, '6GiB');
  assert.equal(build['continue-on-error'], undefined);
});
