import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { splitSqlStatements, stripSqlComments } = serializedInventorySqlParser;

test('preserves comment-like text in quoted and dollar-quoted SQL', () => {
  const source = [
    "SELECT 'https://example.test/a--b/*literal*/;'; -- remove this",
    'DO $fixture$ BEGIN',
    "  RAISE NOTICE 'message -- /*literal*/'; -- remove this too",
    'END; $fixture$;',
  ].join('\n');

  const stripped = stripSqlComments(source);
  assert.match(stripped, /a--b\/\*literal\*\/;/);
  assert.match(stripped, /message -- \/\*literal\*\//);
  assert.doesNotMatch(stripped, /remove this/);
});

test('does not split statements at semicolons inside quoted literals', () => {
  const source = stripSqlComments(
    "UPDATE products SET note = 'semi;--literal/*text*/', payload = $literal$semi;--text$literal$; UPDATE products SET stock_quantity = 1;"
  );
  const statements = splitSqlStatements(source);

  assert.equal(statements.length, 2);
  assert.match(statements[0].text, /semi;--literal\/\*text\*\//);
  assert.match(statements[1].text, /stock_quantity = 1/);
});

test('strips nested block comments through their matching outer terminator', () => {
  const stripped = stripSqlComments(
    '/* outer /* inner */ CREATE FUNCTION private.fake() RETURNS void AS $$ BEGIN NULL; END; $$; */ SELECT 1;'
  );

  assert.doesNotMatch(stripped, /CREATE FUNCTION private\.fake/);
  assert.match(stripped, /SELECT 1;/);
});
