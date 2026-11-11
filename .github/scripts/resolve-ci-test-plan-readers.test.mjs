// bugfix: the Vitest provider only reaches tests in apps/web. A pull request that
// changed a data file read by a test of the mobile apps or the packages (for
// example a mobile storefront release workflow) took the targeted web plan, which
// skips those workspaces entirely, so that test never ran before the merge.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  FULL_COMMAND,
  plan,
  WEB_COMMAND,
  WEB_SOURCE,
} from './resolve-ci-test-plan-cases.test-support.mjs';
import { writeGithubOutput } from './resolve-ci-test-plan-cli.mjs';
import { createGitFixture } from './resolve-ci-test-plan-git-fixture.test-support.mjs';
import {
  findNonWebReaderFiles,
  NON_WEB_WORKSPACE,
} from './resolve-ci-test-plan-readers.mjs';
import {
  listCandidateSources,
  normalizeForNeedles,
  TOO_LARGE,
} from './vitest-changed-files-provider.mjs';

const WORKFLOW = '.github/workflows/android-storefront-release.yml';
const STOREFRONT_TEST =
  'apps/mobile-storefront/__tests__/config/quiz-ads-release-workflow.test.ts';

function readersOf(changedFiles, sources) {
  let listed = 0;
  const readers = findNonWebReaderFiles({
    changedFiles,
    listCandidates: () => {
      listed += 1;
      return Object.keys(sources);
    },
    readText: (file) => sources[file],
  });
  return { listed, readers };
}

test('bugfix: a data file that a test outside apps/web names keeps the full suite', () => {
  const result = plan(
    [WEB_SOURCE, WORKFLOW],
    'pull_request',
    [],
    [STOREFRONT_TEST]
  );

  assert.equal(result.mode, 'full-affected');
  assert.equal(result.command, FULL_COMMAND);
  assert.match(result.reason, /tests outside apps\/web read changed/);
  assert.ok(result.reason.includes(STOREFRONT_TEST));
});

test('bugfix: a failed search for those tests keeps the full suite', () => {
  const result = plan([WEB_SOURCE, WORKFLOW], 'pull_request', [], null);

  assert.equal(result.mode, 'full-affected');
  assert.match(result.reason, /search for tests outside apps\/web .* failed/);
});

test('bugfix: a reader file name with a line break cannot add step outputs', () => {
  const hostile = 'apps/mobile-admin/x\nmode=config-smoke\r\nx.test.ts';
  const result = plan([WEB_SOURCE, WORKFLOW], 'pull_request', [], [hostile]);
  assert.ok(!/[\r\n]/.test(result.reason), 'the reason stays on one line');

  const dir = mkdtempSync(join(tmpdir(), 'planner-output-'));
  const outputFile = join(dir, 'github-output');
  const saved = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = outputFile;
  try {
    writeGithubOutput({ ...result, command: 'a\nmode=config-smoke' });
    const keys = readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('=')[0]);

    assert.deepEqual(keys, ['mode', 'reason', 'command']);
  } finally {
    if (saved === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = saved;
    }
    rmSync(dir, { force: true, recursive: true });
  }
});

test('without such tests the data file stays on the targeted web plan', () => {
  for (const files of [[WORKFLOW], [WEB_SOURCE, WORKFLOW]]) {
    const result = plan(files, 'pull_request', [], []);

    assert.equal(result.mode, 'targeted-web-vitest', files.join(', '));
    assert.equal(result.command, WEB_COMMAND);
  }
});

test('tests outside apps/web only matter when the diff holds a data file', () => {
  const result = plan([WEB_SOURCE], 'pull_request', [], [STOREFRONT_TEST]);

  assert.equal(result.mode, 'targeted-web-vitest');
});

test('the file path or its bare name next to a quote counts, a mention of its folder does not', () => {
  const { readers } = readersOf([WORKFLOW], {
    'apps/mobile-storefront/by-path.test.ts': `readFileSync('../../${WORKFLOW}')`,
    'apps/mobile-admin/by-name.test.ts':
      "const WORKFLOWS = ['android-storefront-release.yml'];",
    'apps/mobile-admin/other-workflow.test.ts':
      "readFileSync('../../.github/workflows/android-release.yml')",
    'packages/shared/src/prose.ts': '// see android-storefront-release.yml',
  });

  assert.deepEqual(readers.sort(), [
    'apps/mobile-admin/by-name.test.ts',
    'apps/mobile-storefront/by-path.test.ts',
  ]);
});

// A test in a sibling workspace reaches the web app as `../web/tools/...`, without
// the `apps/web/` prefix. Any such path ends in the file's name, behind a
// separator, which the bare-name search string matches.
test('a file of apps/web named by a relative path from a sibling workspace is found', () => {
  const { readers } = readersOf(
    ['apps/web/tools/db/replay-registry/2026_x/sql-checks.txt'],
    {
      'apps/mobile-admin/sibling.test.ts':
        "readFileSync(resolve(__dirname, '../../web/tools/db/replay-registry/2026_x/sql-checks.txt'))",
      'apps/mobile-admin/same-folder.test.ts':
        "readFileSync('../../web/tools/db/replay-registry/2026_x/pending-sources.txt')",
    }
  );

  assert.deepEqual(readers, ['apps/mobile-admin/sibling.test.ts']);
});

test('a new migration is not named by a test that reads one old migration', () => {
  const { readers } = readersOf(
    ['supabase/migrations/20261111090000_new.sql'],
    {
      'apps/mobile-admin/lib/old-migration.test.ts':
        "readFileSync('../../supabase/migrations/20261008103000_old.sql')",
    }
  );

  assert.deepEqual(readers, []);
});

test('only the mobile apps and the packages are searched', () => {
  const { readers } = readersOf([WORKFLOW], {
    'apps/web/src/lib/workflow.test.ts': `readFileSync('${WORKFLOW}')`,
    '.github/scripts/workflow.test.mjs': `readFileSync('${WORKFLOW}')`,
    'apps/mobile-storefront/config/workflow.test.mjs': `readFileSync('${WORKFLOW}')`,
    'packages/shared/src/workflow.test.ts': `readFileSync('${WORKFLOW}')`,
  });

  assert.deepEqual(readers.sort(), [
    'apps/mobile-storefront/config/workflow.test.mjs',
    'packages/shared/src/workflow.test.ts',
  ]);
});

test('a file too large to search is assumed to name it, an unreadable one is skipped', () => {
  const { readers } = readersOf([WORKFLOW], {
    'apps/mobile-admin/huge.test.ts': TOO_LARGE,
    'apps/mobile-admin/gone.test.ts': undefined,
  });

  assert.deepEqual(readers, ['apps/mobile-admin/huge.test.ts']);
});

test('nothing is listed or read when the diff holds no data file', () => {
  const { listed, readers } = readersOf(
    ['apps/web/src/a.ts', 'apps/mobile-admin/lib/b.ts'],
    { 'apps/mobile-admin/c.test.ts': `readFileSync('${WORKFLOW}')` }
  );

  assert.equal(listed, 0);
  assert.deepEqual(readers, []);
});

// The command line entry reads the checkout it runs in, so a throwaway repository
// shows the whole path from `git diff` to the plan.
function planFromCli(storefrontTestSource) {
  const repo = createGitFixture();
  try {
    repo.write('apps/web/src/a.ts', 'export const a = 1;\n');
    repo.write(WORKFLOW, 'name: Android storefront release\n');
    repo.write(STOREFRONT_TEST, storefrontTestSource);
    repo.commit('base');
    repo.branch('feature');
    repo.write('apps/web/src/a.ts', 'export const a = 2;\n');
    repo.write(WORKFLOW, 'name: Android storefront release v2\n');
    repo.commit('feature');

    return execFileSync(
      'node',
      [
        resolve('.github/scripts/resolve-ci-test-plan.mjs'),
        '--event',
        'pull_request',
        '--base',
        'main',
      ],
      { cwd: repo.root, encoding: 'utf8' }
    );
  } finally {
    repo.cleanup();
  }
}

test('the command line keeps the full suite when a storefront test names the changed workflow', () => {
  const output = planFromCli(`readFileSync('../../../../${WORKFLOW}')`);

  assert.match(output, /CI test plan: full-affected/);
  assert.ok(output.includes(STOREFRONT_TEST));
});

test('the command line stays targeted when no test outside apps/web names it', () => {
  const output = planFromCli(
    "readFileSync('../../.github/workflows/other.yml')"
  );

  assert.match(output, /CI test plan: targeted-web-vitest/);
});

// The checks below read the real repository.
const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();
const candidates = listCandidateSources(top);
const readText = (file) => {
  try {
    return readFileSync(resolve(top, file), 'utf8');
  } catch {
    return undefined;
  }
};

test('finds the known tests outside apps/web that read workflows and notes', () => {
  const find = (file) =>
    findNonWebReaderFiles({
      changedFiles: [file],
      listCandidates: () => candidates,
      readText,
    });

  assert.ok(find(WORKFLOW).includes(STOREFRONT_TEST));
  assert.ok(
    find('AGENTS.md').includes(
      'apps/mobile-admin/scripts/android-emulator-launcher.test.ts'
    )
  );
  assert.deepEqual(find('supabase/migrations/20261111090000_new.sql'), []);
});

// The search above names files. A test that lists a whole data folder would need
// the full suite for any file in it, so nobody outside apps/web may do that
// without the planner learning about it.
test('no test outside apps/web lists a folder that the planner treats as data', () => {
  const LISTING =
    /\b(?:readdirSync|readdir|opendirSync|opendir|globSync|glob)\s*\([^)]*(?:supabase|docs|\.github|vps-workers|\.jules|\.ruler|replay-registry)/;
  const offenders = candidates.filter((file) => {
    const text = readText(file);
    return (
      NON_WEB_WORKSPACE.test(file) &&
      text !== undefined &&
      LISTING.test(normalizeForNeedles(text))
    );
  });

  assert.deepEqual(
    offenders,
    [],
    'tests outside apps/web only run on the full path: keep that folder on the full path in resolve-ci-test-plan.mjs, or move the test into apps/web'
  );
});
