// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { BLOG_INTENTS } from '@/config/blog-intent';

it('keeps the intent vocabulary aligned with the database constraint', () => {
  // When the vocabulary changes, add a follow-up migration and point this
  // contract test at it; never rewrite an applied migration.
  const migration = readFileSync(
    new URL(
      '../../../../../supabase/migrations/20261004150000_add_blog_post_intent_metadata.sql',
      import.meta.url
    ),
    'utf8'
  );
  const values = migration.match(
    /CHECK\s*\(intent IS NULL OR intent IN\s*\(([^)]+)\)/u
  )?.[1];
  expect(values).toBeDefined();
  const databaseIntents = [...(values ?? '').matchAll(/'([^']+)'/gu)].map(
    (match) => match[1]
  );
  expect(databaseIntents.sort()).toEqual([...BLOG_INTENTS].sort());
});
