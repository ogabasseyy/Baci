import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSqlFunctionDefinition } from './extract-sql-function-definition.mjs';

test('rejects an unterminated dollar-quoted definition before sending SQL', () => {
  assert.throws(
    () =>
      extractSqlFunctionDefinition(
        'CREATE OR REPLACE FUNCTION public.check_order() RETURNS void AS $$ BEGIN NULL; END;',
        'public',
        'check_order'
      ),
    /Unterminated check_order/
  );
});

test('extracts the complete definition without adjacent statements', () => {
  for (const quote of ['$$', '$body$']) {
    const definition = `CREATE OR REPLACE FUNCTION public.check_order() RETURNS void AS ${quote} BEGIN NULL; END; ${quote};`;
    assert.equal(
      extractSqlFunctionDefinition(
        `-- migration\n${definition}\nSELECT 1;`,
        'public',
        'check_order'
      ),
      definition
    );
  }
});

test('distinguishes missing definitions from missing bodies', () => {
  assert.throws(
    () => extractSqlFunctionDefinition('SELECT 1;', 'public', 'check_order'),
    /Missing check_order/
  );
  assert.throws(
    () =>
      extractSqlFunctionDefinition(
        'CREATE OR REPLACE FUNCTION public.check_order() RETURNS void;',
        'public',
        'check_order'
      ),
    /Missing body check_order/
  );
});
