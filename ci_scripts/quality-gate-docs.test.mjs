import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// The local-check commands in the agent instructions are copied from the Ruler
// sources into AGENTS.md and CLAUDE.md. These tests keep the copies identical
// and run the documented commands against a stub pnpm, so the docs cannot
// promise "this runs the full task" while exporting a stale or empty base.

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Text from `heading` to the next "## " or "# " heading (or the end).
function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const body = text.slice(start + 1);
  const next = body.slice(heading.length).search(/\n#{1,2} /);
  return next === -1 ? body : body.slice(0, heading.length + next);
}

const SOURCES = {
  '## ALWAYS Do': '.ruler/01-critical-rules.md',
  '## Quality Gate': '.ruler/02-code-standards.md',
  '## Pre-Completion Checklist': '.ruler/07-testing.md',
  '## Local Runs vs CI': '.ruler/07-testing.md',
};
const COPIES = ['AGENTS.md', 'CLAUDE.md'];

for (const [heading, source] of Object.entries(SOURCES)) {
  for (const copy of COPIES) {
    test(`${copy} carries the same "${heading}" section as ${source}`, () => {
      assert.equal(
        section(read(copy), heading),
        section(read(source), heading)
      );
    });
  }
}

// Every `pnpm turbo <task> ${base:+--affected}` command, with whatever prefix
// sets the base (an `env ...` wrapper or a VAR=value assignment).
const COMMAND =
  /(?:env \S+ |[A-Z_]+=\S+ )?pnpm turbo \S+ \$\{base:\+--affected\}/g;
const DOC_FILES = [
  '.ruler/02-code-standards.md',
  '.ruler/07-testing.md',
  ...COPIES,
];

function documentedCommands(path) {
  return (read(path).match(COMMAND) ?? []).map((command) =>
    command.replace('<lint|typecheck|test>', 'lint')
  );
}

const STUB_BASE = 'abc123def456abc123def456abc123def456abc1';
const shells = ['bash', 'zsh'].filter(
  (shell) => spawnSync(shell, ['-c', 'true']).status === 0
);

// Runs every command in one shell, one output line per command.
function runDocumented(shell, commands, helperBase) {
  const dir = mkdtempSync(join(tmpdir(), 'qg-docs-'));
  try {
    mkdirSync(join(dir, 'ci_scripts'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'ci_scripts/quality-gate-affected-base.sh'),
      '#!/bin/sh\nprintf "%s\\n" "$STUB_BASE"\n'
    );
    writeFileSync(
      join(dir, 'bin/pnpm'),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion inside a stub script
      '#!/bin/sh\nprintf "pnpm [%s] TURBO_SCM_BASE=%s\\n" "$*" "${TURBO_SCM_BASE-<unset>}"\n'
    );
    chmodSync(join(dir, 'bin/pnpm'), 0o755);
    const env = {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      STUB_BASE: helperBase,
    };
    delete env.TURBO_SCM_BASE;
    const script = `base=$(sh ci_scripts/quality-gate-affected-base.sh)\n${commands.join('\n')}\n`;
    const result = spawnSync(shell, ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const taskOf = (command) => command.match(/pnpm turbo (\S+)/)[1];

for (const path of DOC_FILES) {
  test(`${path} documents at least one affected-scope command`, () => {
    assert.ok(documentedCommands(path).length > 0);
  });

  for (const shell of shells) {
    test(`bugfix: ${path} commands leave TURBO_SCM_BASE unset for the full gate in ${shell}`, () => {
      const commands = documentedCommands(path);
      assert.deepEqual(
        runDocumented(shell, commands, ''),
        commands.map(
          (command) => `pnpm [turbo ${taskOf(command)}] TURBO_SCM_BASE=<unset>`
        )
      );
    });

    test(`${path} commands pass --affected once and export the base in ${shell}`, () => {
      const commands = documentedCommands(path);
      assert.deepEqual(
        runDocumented(shell, commands, STUB_BASE),
        commands.map(
          (command) =>
            `pnpm [turbo ${taskOf(command)} --affected] TURBO_SCM_BASE=${STUB_BASE}`
        )
      );
    });
  }
}
