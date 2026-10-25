import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildAuditSpecCorrectionSql } from './build-audit-spec-correction-sql.mjs';

import rows from './fixtures/audit-20261025-specs.json' with { type: 'json' };

test('every update is merchant scoped and rejects concurrent changes atomically', () => {
  const sql = buildAuditSpecCorrectionSql(rows);
  assert.equal((sql.match(/merchant_id=/g) ?? []).length, 12);
  assert.equal((sql.match(/changed <> 1/g) ?? []).length, 12);
  assert.equal((sql.match(/md5\(specifications::text\)/g) ?? []).length, 6);
  assert.match(sql, /^--[\s\S]*begin;[\s\S]*commit;\n$/);
  assert.doesNotMatch(sql, /set (price|stock_quantity|condition)\s*=/i);
});
test('refuses incomplete, duplicate or unknown product batches', () => {
  assert.throws(() => buildAuditSpecCorrectionSql(rows.slice(0, 5)));
  assert.throws(() =>
    buildAuditSpecCorrectionSql([...rows.slice(0, 5), rows[0]])
  );
  assert.throws(() =>
    buildAuditSpecCorrectionSql(
      rows.map((r, i) => (i === 0 ? { ...r, slug: 'unknown' } : r))
    )
  );
});
