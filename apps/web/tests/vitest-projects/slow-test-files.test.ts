import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SLOW_TEST_FILES_FIRST } from '../../vitest.slow-test-files';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// The sequencer itself is tested next to its source, in vitest.sequencer.test.ts.
describe('vitest.slow-test-files list', () => {
  it('lists at least one file', () => {
    expect(SLOW_TEST_FILES_FIRST.length).toBeGreaterThan(0);
  });

  it.each(
    SLOW_TEST_FILES_FIRST
  )('lists %s as a plain relative path to an existing test file', (file) => {
    // A renamed or mistyped entry would match nothing and silently put the
    // slow test back at the end of its shard.
    expect(file).toMatch(/\.(test|spec)\.(c|m)?[jt]sx?$/);
    expect(file).not.toMatch(/^(\.{0,2}\/|\/)/);
    expect(file).not.toContain('\\');
    expect(statSync(path.join(WEB_ROOT, file)).isFile()).toBe(true);
  });

  it('lists each file once', () => {
    expect(new Set(SLOW_TEST_FILES_FIRST).size).toBe(
      SLOW_TEST_FILES_FIRST.length
    );
  });
});

describe('vitest.config.ts sequencer wiring', () => {
  it('sets SlowFilesFirstSequencer once, at the root of test', () => {
    // Read as text: importing the config here costs about 8 s of transform,
    // because the config pulls in the React plugin. Vitest ignores a sequencer
    // set inside a project, so only a direct child of `test` (four spaces of
    // indent) counts; if it is dropped the slow files go back to the end.
    const source = readFileSync(
      path.join(WEB_ROOT, 'vitest.config.ts'),
      'utf8'
    );

    expect(source).toContain(
      "import { SlowFilesFirstSequencer } from './vitest.sequencer';"
    );
    expect(source).toMatch(
      /^ {4}sequence: \{ sequencer: SlowFilesFirstSequencer \},$/m
    );
  });
});
