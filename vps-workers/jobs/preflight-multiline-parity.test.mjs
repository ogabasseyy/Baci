import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findMultilineDotenvAssignments } from './preflight-dotenv-assignments.mjs';

describe('preflight multiline dotenv assignments', () => {
  it('rejects multiline values for keys the shell boundary reads', () => {
    // dotenv joins `"line1` with a later line, while the line-oriented
    // shell reader hands the poller the first line only.
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD="line1\nline2"\n'),
      ['GIGL_PASSWORD (line 1)']
    );
    assert.deepEqual(
      findMultilineDotenvAssignments("GIGL_PASSWORD='abc\ndef'\n"),
      ['GIGL_PASSWORD (line 1)']
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD=`ab\ncd`\n'),
      ['GIGL_PASSWORD (line 1)']
    );
    assert.deepEqual(
      findMultilineDotenvAssignments(
        'NEXT_PUBLIC_SUPABASE_URL="https://x\n"\n'
      ),
      ['NEXT_PUBLIC_SUPABASE_URL (line 1)']
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD: "line1\nline2"\n'),
      ['GIGL_PASSWORD (line 1)']
    );
    // Terminated quotes (escapes honored), unquoted values, comments,
    // and other workers' keys are not flagged.
    assert.deepEqual(
      findMultilineDotenvAssignments(
        [
          'GIGL_PASSWORD="abc\\"#def"',
          "GIGL_EMAIL='a#b'",
          'GIGL_BASE_URL=https://x#y',
          '# GIGL_PASSWORD="unterminated',
          'OTHER_WORKER_KEY="line1',
          'line2"',
          '',
        ].join('\n')
      ),
      []
    );
  });

  it('matches dotenv on single-line quote edge cases (dotenv 17.4.2)', () => {
    // dotenv's greedy match with backtracking closes at the last
    // usable quote (`"abc\"` parses to `abc\`), and a missing closer
    // falls back to a single-line unquoted parse — either way the
    // line-oriented shell reader sees the same bytes, so flagging any
    // of these would block a deploy whose runtime bytes are
    // unambiguous.
    assert.deepEqual(
      findMultilineDotenvAssignments("GIGL_PASSWORD='abc\\'\n"),
      []
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD="abc\\"\n'),
      []
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD: "unterminated\n'),
      []
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD=`abc\\`\n'),
      []
    );
  });

  it('accepts escape-expanded newlines on one physical line', () => {
    // dotenv expands `\n` inside double quotes to an embedded LF, but
    // the assignment stays on one physical line that the shell reader
    // reproduces exactly — including a trailing escape, which the
    // trailing-newline check (not this scan) owns.
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD="a\\nb"\n'),
      []
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD="abc\\n"\n'),
      []
    );
    assert.deepEqual(
      findMultilineDotenvAssignments("GIGL_PASSWORD='a\\nb'\n"),
      []
    );
  });

  it('flags a value that starts on the next physical line', () => {
    // dotenv's `=` separator swallows the newline, so the shell
    // reader's empty first line diverges from dotenv's value.
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD=\n"secret"\n'),
      ['GIGL_PASSWORD (line 1)']
    );
  });

  it('flags separators that span physical lines', () => {
    // dotenv accepts whitespace across `=`/`:` (dotenv 17.4.2), so a
    // bare `KEY` or `KEY:` line still parses — but no physical line
    // assigns the key in shell form, so the line reader misses a
    // credential the required-value check passes.
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD:\nsecret\n'),
      ['GIGL_PASSWORD (line 1)']
    );
    assert.deepEqual(
      findMultilineDotenvAssignments('GIGL_PASSWORD\n=secret\n'),
      ['GIGL_PASSWORD (line 1)']
    );
    // A spanning separator with an empty value agrees (shell-empty is
    // dotenv-empty); the required-value check reports it missing.
    assert.deepEqual(findMultilineDotenvAssignments('GIGL_PASSWORD\n=\n'), []);
    // dotenv's dotted/dashed keys are unreadable at the shell
    // boundary (identifier enumerator), so they cannot diverge.
    assert.deepEqual(findMultilineDotenvAssignments('GIGL_X-Y:\nsecret\n'), []);
  });

  it('leaves swallowed keys to the required-value check', () => {
    // A non-shell span swallowing a GIGL line removes the key from
    // dotenv's output; the required-value check reports it missing.
    // The multiline scan stays silent (no line number could blame the
    // right line), so this pins that contract.
    assert.deepEqual(
      findMultilineDotenvAssignments(
        'OTHER="start\nGIGL_PASSWORD=secret\nend"\n'
      ),
      []
    );
  });
});
