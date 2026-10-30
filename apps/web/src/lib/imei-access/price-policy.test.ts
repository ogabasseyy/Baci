import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  IMEI_SERVICE_TIERS,
  PUBLIC_IMEI_SERVICE_TIERS,
} from '@baci/shared/imei';
import { expect, it } from 'vitest';

it('pins every purchasable tier to the same retail price in the authenticated gateway', () => {
  const sql = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../supabase/migrations/20261030181744_imei_approved_price_reductions.sql'
    ),
    'utf8'
  );
  const prices = Object.fromEntries(
    [...sql.matchAll(/WHEN '([^']+)' THEN (\d+)/g)].map((match) => [
      match[1],
      Number(match[2]),
    ])
  );
  expect(prices).toEqual(
    Object.fromEntries(
      PUBLIC_IMEI_SERVICE_TIERS.map((key) => [
        key,
        IMEI_SERVICE_TIERS[key].price,
      ])
    )
  );
});

it('preserves every latest gateway operation and guard when changing retail prices', () => {
  const normalize = (file: string) =>
    readFileSync(
      resolve(import.meta.dirname, '../../../../../supabase/migrations', file),
      'utf8'
    )
      .replace(/--[^\n]*/g, '')
      .replace(/(WHEN '[^']+' THEN )\d+/g, '$1<retail>')
      .trim();
  expect(normalize('20261030181744_imei_approved_price_reductions.sql')).toBe(
    normalize('20261030125541_imei_refund_unsubmitted_petrock_debits.sql')
  );
});
