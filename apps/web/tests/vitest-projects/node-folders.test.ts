import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NODE_PROJECT_FOLDERS } from '../../vitest.node-folders';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('vitest.node-folders manifest', () => {
  it('lists at least one folder', () => {
    expect(NODE_PROJECT_FOLDERS.length).toBeGreaterThan(0);
  });

  it.each(
    NODE_PROJECT_FOLDERS
  )('lists %s as a plain relative folder that exists', (folder) => {
    // A typo or a wildcard would silently match no tests, leaving the folder
    // in the jsdom project without anyone noticing. Parentheses and brackets
    // are legal: Next.js route groups and dynamic segments are real folder
    // names, which vitest.config.ts escapes before building globs.
    expect(folder).not.toMatch(/^(\.{0,2}\/|\/)/);
    expect(folder).not.toMatch(/\/$/);
    expect(folder).not.toMatch(/[*?{}\\]/);
    expect(folder.split('/')).not.toContain('..');
    expect(statSync(path.join(WEB_ROOT, folder)).isDirectory()).toBe(true);
  });

  it('lists each folder once and none inside another listed folder', () => {
    expect(new Set(NODE_PROJECT_FOLDERS).size).toBe(
      NODE_PROJECT_FOLDERS.length
    );

    for (const folder of NODE_PROJECT_FOLDERS) {
      const parent = NODE_PROJECT_FOLDERS.find(
        (other) => other !== folder && folder.startsWith(`${other}/`)
      );

      expect(
        parent,
        `${folder} is already covered by ${parent}`
      ).toBeUndefined();
    }
  });
});
