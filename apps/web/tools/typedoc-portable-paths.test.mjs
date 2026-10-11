// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);

function invalidPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(
      `${entry.name}${entry.isDirectory() ? '/' : ''}`,
      directory
    );
    return [
      ...(/[<>:"\\|?*]/.test(entry.name) ? [fileURLToPath(path)] : []),
      ...(entry.isDirectory() ? invalidPaths(path) : []),
    ];
  });
}

describe('TypeDoc Windows checkout regression', () => {
  for (const prefix of ['', 'apps/web/']) {
    it(`keeps ${prefix}generated documentation paths portable`, () => {
      expect(invalidPaths(new URL(`${prefix}docs/api/`, root))).toEqual([]);
      const index = readFileSync(
        new URL(`${prefix}docs/api/types/css-modules/README.md`, root),
        'utf8'
      );
      expect(index).toContain('](css-files/README.md)');
      expect(
        existsSync(
          new URL(
            `${prefix}docs/api/types/css-modules/css-files/README.md`,
            root
          )
        )
      ).toBe(true);
    });

    it(`excludes wildcard CSS ambient declarations from ${prefix}documentation generation`, () => {
      const config = JSON.parse(
        readFileSync(new URL(`${prefix}typedoc.json`, root), 'utf8')
      );
      expect(config.exclude).toContain('**/css-modules.d.ts');
    });
  }
});
