import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

describe('merchant classification migration replay registration', () => {
  it('runs the classification contract and isolated permission suite in CI', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const workflow = readFileSync(
      resolve(root, '.github/workflows/ci.yml'),
      'utf8'
    );
    expect(workflow).toContain(
      '--sql-check supabase/tests/merchant_blog_classification_schema_contract.sql'
    );
    expect(workflow).toContain(
      'run: bash supabase/tests/run-merchant-blog-classification.sh'
    );
  });

  it('pins every new classification migration to its current bytes as pending', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const files = readdirSync(resolve(root, 'supabase/migrations')).filter(
      (name) => name.includes('_merchant_blog_classification_')
    );
    expect(files).toHaveLength(7);
    for (const name of files) {
      const repositoryPath = `supabase/migrations/${name}`;
      const sha256 = createHash('sha256')
        .update(readFileSync(resolve(root, repositoryPath)))
        .digest('hex');
      const source = { repositoryPath, sha256 };
      expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual(
        source
      );
      expect(EXPECTED_PENDING_SOURCES).toContainEqual(source);
      expect(
        supabaseHistoryReplayManifest.postReplaySources
      ).not.toContainEqual(source);
    }
  });
});
