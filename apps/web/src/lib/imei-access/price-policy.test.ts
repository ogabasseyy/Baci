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
      '../../../../../supabase/migrations/20261030120000_imei_authenticated_access_boundary.sql'
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
