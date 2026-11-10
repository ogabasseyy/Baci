import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
});
