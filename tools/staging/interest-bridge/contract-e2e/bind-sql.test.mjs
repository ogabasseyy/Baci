import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSql } from './bind-sql.mjs';

test('binds quote-bearing JSON, bytea, null and repeated parameters safely', () => {
  assert.equal(
    bindSql('SELECT $1::json,$2::bytea,$3::text,$4::integer,$1::text', [
      '{"value":"quote\' $2"}',
      Buffer.from([0, 255]),
      null,
      733,
    ]),
    "SELECT '{\"value\":\"quote'' $2\"}'::json,decode('00ff', 'hex')::bytea,NULL::text,733::integer,'{\"value\":\"quote'' $2\"}'::text"
  );
});

test('refuses missing, unused, unsafe numeric and non-SELECT inputs', () => {
  for (const [statement, parameters] of [
    ['SELECT $2', ['missing']],
    ['SELECT $1', ['first', 'unused']],
    ['SELECT $1', [Number.NaN]],
    ['SELECT $1', [{}]],
    ['DELETE FROM anything', []],
  ])
    assert.throws(() => bindSql(statement, parameters));
});
