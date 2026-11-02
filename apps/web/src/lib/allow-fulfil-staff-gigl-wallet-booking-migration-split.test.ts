import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FULFIL_STAFF_GIGL_MIGRATIONS,
  MIGRATIONS_DIRECTORY,
  readMigration,
} from './allow-fulfil-staff-gigl-wallet-booking-migrations.test-support';

const files = FULFIL_STAFF_GIGL_MIGRATIONS.map((migration) => ({
  ...migration,
  sql: readMigration(migration.name),
}));
const count = (source: string, text: string) => source.split(text).length - 1;

describe('fulfil staff GIG wallet migration split', () => {
  it('ships exactly the ordered series, with no leftover single file', () => {
    const names = FULFIL_STAFF_GIGL_MIGRATIONS.map(({ name }) => name);
    expect(names).toEqual([...names].sort());
    expect(
      readdirSync(MIGRATIONS_DIRECTORY).filter((name) =>
        name.startsWith('2026103113')
      )
    ).toEqual(names);
  });

  it.each(files)('$name stays within the 300-line file limit', ({ sql }) => {
    expect(sql.endsWith('\n')).toBe(true);
    expect(count(sql, '\n')).toBeLessThanOrEqual(300);
  });

  it.each(
    files.flatMap((file) =>
      file.functions.map((name) => ({ ...file, fn: name }))
    )
  )('$name owns $fn with its own REVOKE and GRANT', ({ name, fn, sql }) => {
    const create = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
    const revoke = sql.indexOf(`REVOKE ALL ON FUNCTION ${fn}(`);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(revoke).toBeGreaterThan(create);
    if (fn.startsWith('private.')) {
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${fn}(`);
    } else {
      expect(sql.indexOf(`GRANT EXECUTE ON FUNCTION ${fn}(`)).toBeGreaterThan(
        revoke
      );
    }
    for (const other of files.filter((file) => file.name !== name)) {
      expect(other.sql).not.toContain(`FUNCTION ${fn}(`);
    }
  });

  it('adds the actor columns before the reservation and funding policies use them', () => {
    const [columns] = files;
    expect(columns?.sql).toContain('ADD COLUMN reserved_by uuid;');
    expect(columns?.sql).toContain('ADD COLUMN requested_by uuid;');
    expect(columns?.sql).not.toMatch(/CREATE (OR REPLACE FUNCTION|POLICY)/);
    const funding = files.find(({ name }) => name.includes('_wallet_funding.'));
    expect(funding?.sql).toContain('AND requested_by = (SELECT auth.uid())');
    for (const file of files.slice(1)) {
      expect(file.sql).not.toContain('ADD COLUMN');
    }
  });

  it('reloads the PostgREST schema once, after the last object', () => {
    const notify = "NOTIFY pgrst, 'reload schema';\n";
    const last = files.at(-1);
    expect(last?.sql.endsWith(notify)).toBe(true);
    expect(files.map(({ sql }) => count(sql, 'NOTIFY pgrst'))).toEqual([
      0, 0, 0, 0, 0, 1,
    ]);
  });

  it('keeps the recovery migration out of the customer-checkout recovery release set', () => {
    // The atomic recovery release and the recovery harness select files by
    // this marker; the staff gates are loaded explicitly instead.
    for (const { name } of files) {
      expect(name).not.toContain('_customer_checkout_shipping_recovery_');
    }
  });
});
