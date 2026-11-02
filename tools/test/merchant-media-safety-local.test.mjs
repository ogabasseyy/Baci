import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from 'pg';
import { verifyMediaConcurrency } from './merchant-media-concurrency.mjs';

const repository = resolve(import.meta.dirname, '../..');
const bin =
  process.argv
    .find((arg) => arg.startsWith('--postgres-bin='))
    ?.slice('--postgres-bin='.length) ?? '/opt/homebrew/opt/postgresql@17/bin';

test('merchant media deletion admission and reference guards', async () => {
  const directory = mkdtempSync('/tmp/baci-media-safety-');
  const socket = join(directory, 'socket');
  const data = join(directory, 'data');
  mkdirSync(socket, { mode: 0o700 });
  function run(command, args) {
    const result = spawnSync(join(bin, command), args, {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const client = new Client({
    host: socket,
    port: 55486,
    user: 'postgres',
    database: 'postgres',
  });
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(directory, 'log'),
      '-o',
      `-h '' -k '${socket}' -p 55486`,
      'start',
    ]);
    started = true;
    await client.connect();
    await client.query(
      readFileSync(
        join(repository, 'tools/test/merchant-media-safety-fixture.sql'),
        'utf8'
      )
    );
    // Exercise the final decoder definitions in migration order, including
    // the JSON/HTML stages and encoded-NUL guard already present on main.
    for (const [file, functionName] of [
      [
        '20261009200000_blog_media_json_unicode_unescape.sql',
        'blog_media_json_unescape_string',
      ],
      [
        '20261009210000_blog_media_html_entity_decode.sql',
        'blog_media_decode_html_entities',
      ],
      [
        '20261009210000_blog_media_html_entity_decode.sql',
        'blog_media_percent_decode',
      ],
    ]) {
      const source = readFileSync(
        join(repository, 'supabase/migrations', file),
        'utf8'
      );
      const start = source.indexOf(
        `CREATE OR REPLACE FUNCTION public.${functionName}(`
      );
      const end = source.indexOf('$function$;', start);
      assert.ok(
        start >= 0 && end > start,
        `missing ${functionName} definition`
      );
      await client.query(source.slice(start, end + '$function$;'.length));
    }
    for (const name of [
      '20261101080356_merchant_media_deletion_foundation.sql',
      '20261101080419_merchant_media_reference_guards.sql',
      '20261101080442_merchant_media_deletion_admission.sql',
      '20261101101950_merchant_media_invalid_entity_safety.sql',
      '20261101102030_merchant_media_batch_deletion_admission.sql',
    ])
      await client.query(
        readFileSync(join(repository, 'supabase/migrations', name), 'utf8')
      );
    await client.query(
      readFileSync(
        join(repository, 'supabase/tests/merchant_media_deletion_safety.sql'),
        'utf8'
      )
    );
    await verifyMediaConcurrency(
      { host: socket, port: 55486, user: 'postgres', database: 'postgres' },
      client
    );
  } finally {
    await client.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    rmSync(directory, { recursive: true });
  }
});
