import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FINISHED_STATUSES,
  HELD_STATUSES,
  REFUNDING_STATUS,
} from './wallet-held-imei-charges';

// Pins the app's status classification to the database's allowed values, so
// a new or renamed IMEI check state fails here instead of silently reading
// as a finished charge (Muse).
function allowedLookupStatuses() {
  const dir = join(__dirname, '../../../supabase/migrations');
  const latest = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) =>
      readFileSync(join(dir, name), 'utf8').includes(
        'ADD CONSTRAINT imei_lookups_status_check'
      )
    )
    .at(-1);
  if (!latest) throw new Error('imei_lookups_status_check not found');
  const sql = readFileSync(join(dir, latest), 'utf8');
  const start = sql.indexOf('ADD CONSTRAINT imei_lookups_status_check');
  const check = sql.slice(start, sql.indexOf(';', start));
  return [...check.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]);
}

describe('IMEI lookup status classification', () => {
  it('bugfix: classifies every status the database allows, and only those (Muse)', () => {
    const classified = [
      ...HELD_STATUSES,
      REFUNDING_STATUS,
      ...FINISHED_STATUSES,
    ].sort();
    expect(classified).toEqual(allowedLookupStatuses().sort());
  });
});
