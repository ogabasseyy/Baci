import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { findTrailingNewlineValues } from './preflight-dotenv-assignments.mjs';

const jobsDir = dirname(fileURLToPath(import.meta.url));

function writeFixture(text) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-preflight-newline-'));
  const fixture = join(directory, 'fixture.env');
  writeFileSync(fixture, text);
  return fixture;
}

describe('preflight trailing-newline values', () => {
  it('flags shell-read keys whose parsed value ends with a newline', () => {
    // dotenv expands the escape, so the preflight would validate four
    // bytes while command substitution hands cron three.
    const parsed = parse('GIGL_PASSWORD="abc\\n"\n');
    assert.equal(parsed.GIGL_PASSWORD, 'abc\n');
    assert.deepEqual(findTrailingNewlineValues(parsed), ['GIGL_PASSWORD']);
  });

  it('flags infrastructure keys the shell boundary reads', () => {
    const parsed = parse('BACI_REPO_DIR="/opt/app\\n"\n');
    assert.deepEqual(findTrailingNewlineValues(parsed), ['BACI_REPO_DIR']);
  });

  it('allows mid-value escapes, which survive capture on both sides', () => {
    const parsed = parse('GIGL_PASSWORD="a\\nb"\n');
    assert.equal(parsed.GIGL_PASSWORD, 'a\nb');
    assert.deepEqual(findTrailingNewlineValues(parsed), []);
  });

  it('ignores keys outside the shell-read set', () => {
    assert.deepEqual(
      findTrailingNewlineValues({ PETROCK_API_TOKEN: 'abc\n' }),
      []
    );
  });

  it('fails the preflight run with a loud message', () => {
    const fixture = writeFixture('GIGL_PASSWORD="abc\\n"\n');
    const result = spawnSync(
      process.execPath,
      [join(jobsDir, 'preflight-direct-web-workers.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, BACI_WORKER_ENV: fixture },
      }
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /GIGL_PASSWORD must not end with a newline escape/
    );
  });
});
