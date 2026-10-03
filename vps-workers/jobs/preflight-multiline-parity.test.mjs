import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findMultilineDotenvAssignments } from './preflight-direct-web-workers.mjs';

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
    // A hand-rolled quote scan cannot reproduce dotenv's backtracking:
    // single quotes are raw (a trailing backslash does not escape the
    // closer), and an escaped closing double quote falls back to a
    // single-line unquoted parse. Flagging any of these would block a
    // deploy whose runtime bytes are unambiguous.
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
