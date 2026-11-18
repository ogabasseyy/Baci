import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JSDOM_HOLDOUT_FILES } from '../../vitest.jsdom-holdouts';
import { NODE_PROJECT_FOLDERS } from '../../vitest.node-folders';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('vitest.jsdom-holdouts list', () => {
  it.each(
    JSDOM_HOLDOUT_FILES
  )('lists %s as an existing test file inside a node folder', (file) => {
    // A stale or mistyped entry would match nothing and silently leave the
    // intended test running in the node project, where it needs a DOM.
    expect(file).toMatch(/\.(test|spec)\.(c|m)?[jt]s$/);
    expect(file).not.toMatch(/^(\.{0,2}\/|\/)/);
    expect(
      NODE_PROJECT_FOLDERS.some((folder) => file.startsWith(`${folder}/`))
    ).toBe(true);
    expect(statSync(path.join(WEB_ROOT, file)).isFile()).toBe(true);
  });

  it.each(
    JSDOM_HOLDOUT_FILES
  )('keeps %s free of a docblock, the list already selects jsdom', (file) => {
    const head = readFileSync(path.join(WEB_ROOT, file), 'utf8').slice(0, 300);

    expect(head).not.toContain('@vitest-environment');
  });

  it('lists each file once', () => {
    expect(new Set(JSDOM_HOLDOUT_FILES).size).toBe(JSDOM_HOLDOUT_FILES.length);
  });
});
