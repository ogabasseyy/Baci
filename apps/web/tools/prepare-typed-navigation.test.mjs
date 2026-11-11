import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseOutputArgument,
  prepareTypedNavigation,
  prepareTypedNavigationFile,
} from './prepare-typed-navigation.mjs';

const dynamic =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal generated TypeScript syntax.
  '    | (T extends `${DynamicRoutes<infer _>}${Suffix}` ? T : never)';
const source = `type RouteImpl<T> = StaticRoutes | SearchOrHash | WithProtocol | \`\${StaticRoutes}\${SearchOrHash}\`\n${dynamic}\n`;

describe('Next typed-route inference preparation', () => {
  it('skips dynamic inference only when T is already covered by the existing static branches', () => {
    const output = prepareTypedNavigation(source);
    expect(output).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal generated TypeScript syntax.
      '[T] extends [StaticRoutes | SearchOrHash | WithProtocol | `${StaticRoutes}${SearchOrHash}`] ? never'
    );
    expect(output).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal generated TypeScript syntax.
      '(T extends `${DynamicRoutes<infer _>}${Suffix}` ? T : never)'
    );
    expect(output.slice(0, output.indexOf('\n'))).toBe(
      source.slice(0, source.indexOf('\n'))
    );
    expect(prepareTypedNavigation(output)).toBe(output);
  });
  it.each([
    '',
    'type RouteImpl<T> = string',
    `${source}${source}`,
  ])('fails closed for an unknown or duplicated generated shape', (input) => {
    expect(() => prepareTypedNavigation(input)).toThrow(
      'Unsupported Next typed-route declaration'
    );
  });
  it('updates only the generated file, remains idempotent and leaves unsupported input untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'baci-typed-route-'));
    const path = join(dir, 'link.d.ts');
    try {
      await writeFile(path, source);
      await prepareTypedNavigationFile(path);
      const prepared = await readFile(path, 'utf8');
      await prepareTypedNavigationFile(path);
      expect(await readFile(path, 'utf8')).toBe(prepared);
      await writeFile(path, 'unknown');
      await expect(prepareTypedNavigationFile(path)).rejects.toThrow(
        'Unsupported Next'
      );
      expect(await readFile(path, 'utf8')).toBe('unknown');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('writes the prepared copy elsewhere for the production build and leaves the generated file as Next wrote it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'baci-typed-route-'));
    const path = join(dir, 'link.d.ts');
    const output = join(dir, 'prepared', 'nested', 'link.d.ts');
    try {
      await writeFile(path, source);
      await prepareTypedNavigationFile(path, output);
      expect(await readFile(path, 'utf8')).toBe(source);
      expect(await readFile(output, 'utf8')).toBe(
        prepareTypedNavigation(source)
      );
      // A build after a local typecheck starts from an already-prepared file.
      await prepareTypedNavigationFile(output, output);
      await prepareTypedNavigationFile(output, join(dir, 'again.d.ts'));
      expect(await readFile(join(dir, 'again.d.ts'), 'utf8')).toBe(
        prepareTypedNavigation(source)
      );
      await writeFile(path, 'unknown');
      await expect(
        prepareTypedNavigationFile(path, join(dir, 'never.d.ts'))
      ).rejects.toThrow('Unsupported Next');
      await expect(readFile(join(dir, 'never.d.ts'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('accepts only the optional --output argument', () => {
    expect(parseOutputArgument([])).toBeUndefined();
    expect(parseOutputArgument(['--output', 'out/link.d.ts'])).toBe(
      'out/link.d.ts'
    );
    for (const args of [['--output'], ['out.d.ts'], ['--output', 'a', 'b']]) {
      expect(() => parseOutputArgument(args)).toThrow('Usage:');
    }
  });
});
