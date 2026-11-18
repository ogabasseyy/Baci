// Contract for the storefront release-coherence gate. It runs in the CI deploy-scripts step, so it
// also runs when ONLY the coherence script (or the deploy filter) changes and the web jobs are skipped.
//   1. Every module the coherence script imports (transitively) is listed in, or covered by, the
//      deploy filter, so a change to it cannot skip the production deploy.
//   2. The release-coherence and purge test files are wired into that CI step's active command.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDirectory, '../..');
const CI_STEP_NAME = 'Test Deployment and VPS Worker Scripts';
const REQUIRED_CI_TESTS = [
  'cloudflare-purge-cache-hosts.test.mjs',
  'cloudflare-purge-cache.test.mjs',
  'storefront-release-coherence-deploy-contract.test.mjs',
  'storefront-release-coherence-escalation-safety.test.mjs',
  'storefront-release-coherence-escalation.test.mjs',
  'storefront-release-coherence-host-purge.test.mjs',
  'storefront-release-coherence-warming.test.mjs',
  'storefront-release-coherence.test.mjs',
  'storefront-release-config.test.mjs',
  'storefront-release-marker.test.mjs',
  'storefront-sitemap-purge.test.mjs',
];

// Matches `from './x.mjs'`, side-effect `import './x.mjs'` and dynamic `import('./x.mjs')`, in
// single or double quotes, with optional subdirectories and `../` parents.
const RELATIVE_MODULE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[\w./-]+\.mjs)\1/g;

function collectRelativeModuleImports(source) {
  return [...source.matchAll(RELATIVE_MODULE_IMPORT)].map((match) => match[2]);
}

// Returns the list entries of one top-level filter key. Reads line by line, so blank lines and
// comments inside the list cannot cut it short; the next top-level key ends the section.
function readFilterSection(filters, key) {
  const lines = filters.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
  assert.notEqual(start, -1, `the filter file must define a ${key} filter`);
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z_][\w-]*:/.test(line)) break;
    if (/^\s+- /.test(line)) entries.push(line);
  }
  assert.ok(entries.length > 0, `the ${key} filter has no entries`);
  return `${entries.join('\n')}\n`;
}

// Returns the active `if:` condition and `run:` command of one workflow step. Comment lines are
// dropped, so a path that only appears in a comment or in another step does not count.
function readWorkflowStep(workflow, stepName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^\\s*- name:\\s*${stepName}\\s*$`).test(line));
  assert.notEqual(start, -1, `workflow step "${stepName}" must exist`);
  const dashColumn = lines[start].indexOf('- name:');
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*- (name|uses|id):/.test(line) && line.search(/\S/) <= dashColumn) break;
    body.push(line);
  }
  const condition = body.find((line) => /^\s*if:/.test(line))?.replace(/^\s*if:\s*/, '') ?? '';
  const runIndex = body.findIndex((line) => /^\s*run:/.test(line));
  assert.notEqual(runIndex, -1, `workflow step "${stepName}" must have a run command`);
  const runIndent = body[runIndex].search(/\S/);
  const inline = body[runIndex].replace(/^\s*run:\s*/, '');
  const command = [inline.startsWith('>') || inline.startsWith('|') ? '' : inline];
  for (const line of body.slice(runIndex + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= runIndent) break;
    if (!line.trim().startsWith('#')) command.push(line.trim());
  }
  return { command: command.filter(Boolean).join(' '), condition };
}

test('reads a filter section even with blank and comment lines inside the list', () => {
  const yaml = ['web:', "  - 'a/**'", '', '  # a note between entries', "  - 'b.mjs'", 'other:', "  - 'c.mjs'", ''].join('\n');
  assert.equal(readFilterSection(yaml, 'web'), "  - 'a/**'\n  - 'b.mjs'\n");
  assert.equal(readFilterSection(yaml, 'other'), "  - 'c.mjs'\n");
  assert.throws(() => readFilterSection(yaml, 'missing'), /must define a missing filter/);
});

test('finds relative .mjs imports in every import form the contract must cover', () => {
  assert.deepEqual(
    collectRelativeModuleImports(
      [
        "import a from './a.mjs';",
        'import { b } from "./b.mjs";',
        "import './c.mjs';",
        "const d = await import('./sub/d.mjs');",
        'export * from "../e.mjs";',
        "import fs from 'node:fs';",
        "import local from './not-a-module.json';",
      ].join('\n')
    ),
    ['./a.mjs', './b.mjs', './c.mjs', './sub/d.mjs', '../e.mjs']
  );
});

test('reads a workflow step command and ignores comments and other steps', () => {
  const workflow = [
    '    steps:',
    '      - name: Other step',
    '        run: node --test .github/scripts/mentioned-elsewhere.test.mjs',
    '      # .github/scripts/commented-out.test.mjs',
    '      - name: Demo step',
    "        if: needs.changes.outputs.demo == 'true'",
    '        run: >-',
    '          pnpm test &&',
    '          node --test',
    '          .github/scripts/kept.test.mjs',
    '          # .github/scripts/also-commented.test.mjs',
    '          .github/scripts/second.test.mjs',
    '      - name: Next step',
    '        run: echo .github/scripts/after.test.mjs',
  ].join('\n');
  const step = readWorkflowStep(workflow, 'Demo step');
  assert.equal(step.condition, "needs.changes.outputs.demo == 'true'");
  assert.equal(step.command, 'pnpm test && node --test .github/scripts/kept.test.mjs .github/scripts/second.test.mjs');
  assert.ok(!step.command.includes('mentioned-elsewhere'));
  assert.ok(!step.command.includes('after.test'));
  assert.ok(!step.command.includes('commented-out'));
  assert.ok(!step.command.includes('also-commented'));
});

test('deploys every transitive import of the release-coherence script', () => {
  const deployWebFilter = readFilterSection(
    readFileSync(resolve(repoRoot, '.github/filters/deploy.yml'), 'utf8'),
    'web'
  );
  const globs = [...deployWebFilter.matchAll(/- '([^']+)\/\*\*'/g)].map((match) => match[1]);
  const pending = ['storefront-release-coherence.mjs'];
  const reached = new Set();
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (reached.has(name)) continue;
    reached.add(name);
    const source = readFileSync(resolve(scriptsDirectory, name), 'utf8');
    for (const specifier of collectRelativeModuleImports(source)) {
      // Resolve relative to the importing file, keeping paths relative to .github/scripts.
      pending.push(posix.join(posix.dirname(name), specifier));
    }
  }

  // A dependency missing from the deploy filter would let a change to it skip the production deploy.
  assert.ok(reached.has('storefront-release-coherence-escalation.mjs'));
  assert.ok(reached.has('storefront-release-coherence-canary-urls.mjs'));
  for (const name of reached) {
    // Imports may leave .github/scripts (e.g. ../../apps/web/...), so compare repo-relative paths.
    const repoPath = posix.join('.github/scripts', name);
    const covered =
      deployWebFilter.includes(`- '${repoPath}'`) ||
      globs.some((glob) => repoPath.startsWith(`${glob}/`));
    assert.ok(covered, `${repoPath} must be listed in (or covered by) the deploy filter`);
  }
});

test('runs every release-coherence and purge test in the CI deploy-scripts step', () => {
  const { command, condition } = readWorkflowStep(
    readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
    CI_STEP_NAME
  );
  assert.match(condition, /deploy_scripts == 'true'/);
  for (const testFile of REQUIRED_CI_TESTS) {
    assert.ok(
      command.includes(`.github/scripts/${testFile}`),
      `${testFile} must be in the "${CI_STEP_NAME}" command`
    );
  }
});

test('selects the deploy-scripts job when the marker normalizer in apps/web changes', () => {
  // storefront-release-marker.mjs imports it from apps/web, outside the .github/scripts globs.
  const ciFilters = readFileSync(resolve(repoRoot, '.github/filters/ci.yml'), 'utf8');
  const deployScripts = readFilterSection(ciFilters, 'deploy_scripts');
  assert.ok(deployScripts.includes("- 'apps/web/src/config/next-deployment-id-normalizer.mjs'"));
  assert.ok(deployScripts.includes("- '.github/scripts/storefront-release-coherence*.mjs'"));
});
