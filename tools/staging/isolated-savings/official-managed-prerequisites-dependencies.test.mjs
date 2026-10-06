import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('pins complete Baci Realtime schema dependency closure and optional send guards', () => {
  const directory = new URL('../../../supabase/migrations/', import.meta.url);
  const expected = JSON.parse(
    readFileSync(
      new URL(
        './official-managed-prerequisites-dependencies.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const actual = [];
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const body = readFileSync(new URL(file, directory), 'utf8');
    const sql = body.replace(/--[^\n]*/g, '');
    const references = [...sql.matchAll(/realtime\.([a-z_]+)/g)].map(
      (match) => match[1]
    );
    if (!references.length) continue;
    assert.ok(
      references.every((name) => ['messages', 'topic', 'send'].includes(name)),
      `Unreviewed Realtime dependency: ${file}`
    );
    if (references.includes('send'))
      assert.ok(
        sql
          .replace(/\s+/g, '')
          .includes(
            "to_regprocedure('realtime.send(jsonb,text,text,boolean)')"
          ),
        `Unguarded send dependency: ${file}`
      );
    actual.push({
      file,
      sha256: createHash('sha256').update(body).digest('hex'),
    });
  }
  assert.deepEqual(actual, expected);
});
