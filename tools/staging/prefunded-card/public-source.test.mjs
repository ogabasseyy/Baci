import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertRetirementSourceClosure, snapshot } from './public-source.mjs';

test('requires the email guard and retired-unconfirmed public state before packaging', () => {
  const required = new Map([
    ['apps/web/src/lib/piggyvest/prefunded-card-checkout-public-runtime.ts', Buffer.from('prefundedCardCheckoutEmailSchema')],
    ['apps/web/src/schemas/prefunded-card-checkout-email.ts', Buffer.from('public domain')],
    ['apps/web/src/schemas/prefunded-card-checkout-public-runtime.ts', Buffer.from("'retired_unconfirmed'")],
  ]);
  assert.doesNotThrow(() => assertRetirementSourceClosure(required));
  required.delete('apps/web/src/schemas/prefunded-card-checkout-email.ts');
  assert.throws(() => assertRetirementSourceClosure(required));
});

test('copies only the checkout dependency closure and records immutable source hashes', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'first-card-source-'));
  const root = path.join(temporary, 'source');
  const destination = path.join(temporary, 'snapshot');
  try {
    for (const relative of [
      'apps/web/src/app/api/storefront/customer/savings/card-checkout/route.ts',
      'apps/web/src/app/api/csrf/route.ts',
      'apps/web/src/app/savings/card-return/page.tsx',
      'apps/web/src/lib/piggyvest/prefunded-card-checkout-public-runtime.ts',
      'apps/web/src/schemas/prefunded-card-checkout-email.ts',
      'apps/web/src/schemas/prefunded-card-checkout-public-runtime.ts',
    ]) {
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      const content = relative.endsWith('route.ts')
        ? 'export { prefundedCardCheckoutEmailSchema } from "@/lib/piggyvest/prefunded-card-checkout-public-runtime"; export const runtime = "nodejs";'
        : relative.includes('/lib/piggyvest/prefunded-card-checkout-public-runtime.ts')
          ? 'import { prefundedCardCheckoutEmailSchema } from "@/schemas/prefunded-card-checkout-email"; import { phase } from "@/schemas/prefunded-card-checkout-public-runtime"; export { prefundedCardCheckoutEmailSchema, phase };'
          : relative.endsWith('prefunded-card-checkout-email.ts')
            ? 'export const guard = "public domain";'
            : relative.endsWith('prefunded-card-checkout-public-runtime.ts')
              ? "export const phase = 'retired_unconfirmed';"
              : 'export const runtime = "nodejs";';
      await writeFile(path.join(root, relative), content);
    }
    await writeFile(
      path.join(root, 'apps/web/src/app/proxy.ts'),
      'throw new Error();'
    );
    await writeFile(path.join(root, 'apps/web/.env'), 'SECRET=must-not-copy');
    await mkdir(path.join(root, 'apps/web/src/types'));
    await writeFile(
      path.join(root, 'apps/web/src/types/selection.ts'),
      'export type Selection = { id: string };'
    );
    await writeFile(
      path.join(root, 'apps/web/src/app/api/csrf/route.ts'),
      'import type { Selection } from "../../../types/selection"; export const select = (value: Selection) => value.id;'
    );
    const report = await snapshot(root, destination);
    assert.equal(Object.keys(report.sources).length, 7);
    assert.ok(report.sources['apps/web/src/types/selection.ts']);
    assert.equal(report.sources['apps/web/.env'], undefined);
    assert.equal(report.sources['apps/web/src/app/proxy.ts'], undefined);
    assert.match(
      await readFile(
        path.join(destination, 'apps/web/next.config.mjs'),
        'utf8'
      ),
      /card-assets/
    );
    assert.equal(
      await readFile(
        path.join(destination, 'apps/web/src/public-env.ts'),
        'utf8'
      ),
      "export const getSupabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';\nexport const getSupabaseAnonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';\n"
    );
    await assert.rejects(snapshot(root, destination));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
