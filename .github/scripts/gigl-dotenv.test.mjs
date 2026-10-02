import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function readValue(envFile, key) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-gigl-dotenv-'));
  const fixture = join(directory, 'fixture.env');
  writeFileSync(fixture, envFile);
  const result = spawnSync(
    'bash',
    ['-c', '. "$1"; gigl_dotenv_value "$2" "$3"', 'probe', join(scriptDir, 'gigl-dotenv.sh'), fixture, key],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replace(/\n$/, '');
}

describe('gigl-dotenv', () => {
  it('keeps a `#` after an escaped double quote as data, like dotenv', () => {
    // dotenv 17.4.2 parses `"abc\"#def"` to abc\"#def (escapes literal,
    // `#` inside the quoted region is data). Treating `\"` as the end
    // of the region would truncate a provider password at `#`.
    assert.equal(
      readValue('GIGL_PASSWORD="abc\\"#def"\n', 'GIGL_PASSWORD'),
      'abc\\"#def'
    );
  });

  it('honors an escaped backslash before the closing quote', () => {
    assert.equal(
      readValue('ESC_BS="abc\\\\" # tail\n', 'ESC_BS'),
      'abc\\\\'
    );
  });

  it('keeps `#` inside single quotes as data', () => {
    assert.equal(
      readValue("SINGLE='abc#def'\n", 'SINGLE'),
      'abc#def'
    );
  });

  it('expands \\n and \\r inside double quotes, like dotenv', () => {
    assert.equal(readValue('DQ="a\\nb\\rc"\n', 'DQ'), 'a\nb\rc');
    // Single-pass like dotenv: `\\n` yields a literal backslash plus
    // a newline, not two expansions.
    assert.equal(readValue('ESC="x\\\\ny"\n', 'ESC'), 'x\\\ny');
  });

  it('leaves backslash sequences literal outside double quotes', () => {
    assert.equal(readValue("SQ='a\\nb'\n", 'SQ'), 'a\\nb');
    assert.equal(readValue('UNQ=a\\nb\n', 'UNQ'), 'a\\nb');
  });

  it('preserves mismatched wrapping quotes, like dotenv', () => {
    assert.equal(readValue('MM="abc\'\n', 'MM'), '"abc\'');
    assert.equal(readValue("MM2='abc\"\n", 'MM2'), '\'abc"');
  });

  it('strips trailing comments from unquoted values', () => {
    assert.equal(readValue('PLAIN=abc#def\n', 'PLAIN'), 'abc');
    assert.equal(readValue('SPACED=abc # def\n', 'SPACED'), 'abc');
  });

  it('treats only a leading quote as a quoted region, like dotenv', () => {
    // dotenv 17.4.2: a quote past the first non-whitespace character
    // is data, so the `#` still starts a comment. Opening quote mode
    // mid-value would preserve `#ghi` here and hand the poller
    // different credentials than the preflight validated.
    assert.equal(
      readValue('GIGL_PASSWORD=abc"def#ghi\n', 'GIGL_PASSWORD'),
      'abc"def'
    );
    assert.equal(readValue("SQMID=a'b#c\n", 'SQMID'), "a'b");
    assert.equal(
      readValue('SPACEDQ=abc "def" # x\n', 'SPACEDQ'),
      'abc "def"'
    );
    assert.equal(readValue('REOPEN="a"b#c\n', 'REOPEN'), '"a"b');
    assert.equal(readValue('NOHASH=a"b"c\n', 'NOHASH'), 'a"b"c');
  });

  it('supports export prefixes, spaces, and last-assignment-wins', () => {
    assert.equal(readValue('export KEY=off\n', 'KEY'), 'off');
    assert.equal(readValue('KEY = "off" # rotated\n', 'KEY'), 'off');
    assert.equal(readValue('KEY=on\nKEY=off\n', 'KEY'), 'off');
  });

  it('prints nothing for absent files or keys', () => {
    assert.equal(readValue('OTHER=1\n', 'MISSING'), '');
  });
});
