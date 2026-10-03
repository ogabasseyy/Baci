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

  it('keeps a `#` after an escaped single or backtick quote as data, like dotenv', () => {
    // dotenv 17.4.2 treats an escaped delimiter as non-terminating
    // inside single/backtick quotes (preserving the backslash), so
    // the `#` stays data. Closing at the escaped quote would truncate
    // a provider password the preflight validated in full.
    assert.equal(
      readValue("GIGL_PASSWORD='abc\\'def#ghi'\n", 'GIGL_PASSWORD'),
      "abc\\'def#ghi"
    );
    assert.equal(
      readValue('GIGL_PASSWORD=`abc\\`def#ghi`\n', 'GIGL_PASSWORD'),
      'abc\\`def#ghi'
    );
  });

  it('honors an escaped backslash before the closing quote', () => {
    assert.equal(
      readValue('ESC_BS="abc\\\\" # tail\n', 'ESC_BS'),
      'abc\\\\'
    );
  });

  it('never lets a backslash run use up a quote escape, like dotenv', () => {
    // dotenv 17.4.2: an interior quote is escaped iff immediately
    // preceded by a backslash, however many precede it — so the
    // region still closes at the final quote and `#ghi` stays data.
    // Consuming `\\` as a pair would close early and hand the poller
    // a truncated provider password.
    assert.equal(
      readValue("GIGL_PASSWORD='abc\\\\'def#ghi'\n", 'GIGL_PASSWORD'),
      "abc\\\\'def#ghi"
    );
    assert.equal(
      readValue("GIGL_PASSWORD='abc\\\\\\\\'def#ghi'\n", 'GIGL_PASSWORD'),
      "abc\\\\\\\\'def#ghi"
    );
    assert.equal(
      readValue('GIGL_PASSWORD=`abc\\\\`def#ghi`\n', 'GIGL_PASSWORD'),
      'abc\\\\`def#ghi'
    );
    assert.equal(
      readValue('GIGL_PASSWORD="abc\\\\"def#ghi"\n', 'GIGL_PASSWORD'),
      'abc\\\\"def#ghi'
    );
  });

  it('falls back to an unquoted parse when no closer fits, like dotenv', () => {
    // dotenv 17.4.2: junk after the only usable closer (or no closer
    // at all) re-parses the value unquoted — cut at `#`, then strip
    // one layer of matched surrounding quotes.
    assert.equal(readValue("K='a'b'\n", 'K'), "a'b");
    assert.equal(readValue("K='ab\\\\' # c\n", 'K'), 'ab\\\\');
    assert.equal(readValue("K='abc # c\n", 'K'), "'abc");
    assert.equal(readValue('K="a"b#c\n', 'K'), '"a"b');
  });

  it('expands double-quote escapes even when unstripped, like dotenv', () => {
    // dotenv 17.4.2 expands `\n`/`\r` whenever the trimmed value
    // starts with `"`, including the unterminated fallback (where the
    // opening quote stays literal).
    assert.equal(readValue('K="a\\nb\n', 'K'), '"a\nb');
  });

  it('ends the record at a carriage return, like dotenv', () => {
    // dotenv 17.4.2 normalizes CR to LF before parsing.
    assert.equal(readValue("K='quoted'\r\n", 'K'), 'quoted');
    assert.equal(readValue('K=plain\r\n', 'K'), 'plain');
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

  it('parses dotenv colon assignments, like dotenv', () => {
    // dotenv 17.4.2: `KEY:` (no blank before, blank after) is a
    // separator; `KEY : v` and `KEY:v` are ignored lines.
    assert.equal(readValue('K1: secret\n', 'K1'), 'secret');
    assert.equal(readValue('K2:  spaced\n', 'K2'), 'spaced');
    assert.equal(readValue('export K3: v\n', 'K3'), 'v');
    assert.equal(readValue('K4 :v\n', 'K4'), '');
    assert.equal(readValue('K5:secret\n', 'K5'), '');
    assert.equal(readValue('K6::v\n', 'K6'), '');
    assert.equal(readValue('K7: "quoted" # tail\n', 'K7'), 'quoted');
    assert.equal(readValue("K8: 'sq' # tail\n", 'K8'), 'sq');
    assert.equal(readValue('K9: a#b\n', 'K9'), 'a');
  });

  it('parses backtick-quoted values raw, like dotenv', () => {
    // dotenv 17.4.2: backtick is the third quoted form; escapes do
    // not expand inside it (unlike double quotes).
    assert.equal(readValue('K1=`abc#def`\n', 'K1'), 'abc#def');
    assert.equal(readValue('K2=`a\\nb`\n', 'K2'), 'a\\nb');
    assert.equal(readValue('K3=`a"b` # tail\n', 'K3'), 'a"b');
    assert.equal(readValue('K4=ab`cd#ef\n', 'K4'), 'ab`cd');
    assert.equal(readValue('K5=`abc"\n', 'K5'), '`abc"');
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
