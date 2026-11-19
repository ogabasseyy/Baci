/** @vitest-environment node */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { overrideRoots } from './security-integrity-override-roots';
import { packageMain } from './security-integrity-package-main';
import { packageModule } from './security-integrity-package-module';
import { versionAt } from './security-integrity-version-at';

const require = createRequire(import.meta.url);
const roots =
  overrideRoots(process.env.ZOD_ROOTS, 'ZOD_ROOTS') ??
  findInstalledRoots('zod');

describe('Zod legacy schema compatibility and bounded collection validation', () => {
  it('keeps required A2UI catalog fields in the actual production converter', async () => {
    const [root] = findInstalledRoots('@a2ui/web_core');
    expect(root).toBeDefined();
    const catalogRequire = createRequire(join(root, 'package.json'));
    const { z } = catalogRequire('zod') as typeof import('zod/v3');
    const { MessageProcessor } = await import(
      pathToFileURL(join(root, 'src/v0_9/processing/message-processor.js')).href
    );
    const catalog = {
      id: 'test',
      components: new Map([
        ['Button', { schema: z.object({ label: z.string() }) }],
      ]),
      functions: new Map(),
    };
    const result = new MessageProcessor([catalog]).getClientCapabilities({
      includeInlineCatalogs: true,
    });
    const schema = result['v0.9'].inlineCatalogs[0].components.Button.allOf[1];
    expect(schema.properties.label).toEqual({ type: 'string' });
    expect(schema.required).toContain('label');
  });

  it('finds installed validators to guard', () =>
    expect(roots.length).toBeGreaterThan(0));
  for (const root of roots) {
    for (const format of ['cjs', 'esm'] as const) {
      for (const asynchronous of [false, true]) {
        it(`rejects oversized bounded collections before visiting children in ${root} (${format}, async=${asynchronous})`, async () => {
          const entryPath = join(
            root,
            format === 'cjs' ? packageMain(root) : packageModule(root)
          );
          const entry = (
            format === 'cjs'
              ? require(entryPath)
              : await import(pathToFileURL(entryPath).href)
          ) as typeof import('zod/v3');
          const z = entry.z;
          let visits = 0;
          const element = z.any().superRefine(() => {
            visits++;
          });
          const schemas = [
            [z.array(element).max(2), [1, 2, 3]],
            [z.array(element).length(2), [1, 2, 3]],
            [z.set(element).max(2), new Set([1, 2, 3])],
          ] as const;
          for (const [schema, input] of schemas) {
            visits = 0;
            const parsed = asynchronous
              ? await schema.safeParseAsync(input)
              : schema.safeParse(input);
            expect(parsed.success).toBe(false);
            expect(
              visits,
              `zod ${versionAt(root, 'zod')} visited an already oversized collection`
            ).toBe(0);
            if (!parsed.success)
              expect(parsed.error.issues[0].code).toBe('too_big');
          }
          expect(z.array(z.string()).max(2).parse(['a', 'b'])).toEqual([
            'a',
            'b',
          ]);
          expect(
            z
              .set(z.string())
              .max(2)
              .parse(new Set(['a', 'b']))
          ).toEqual(new Set(['a', 'b']));
        });
      }
    }
  }
});
