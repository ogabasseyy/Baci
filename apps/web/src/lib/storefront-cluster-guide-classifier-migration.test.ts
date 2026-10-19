import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION_SOURCE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260823163001_optimize_storefront_cluster_guide_classifier_ordered_rpc.sql'
  ),
  'utf8'
);
const CLASSIFIER_SOURCE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260823163000_optimize_storefront_cluster_guide_classifier_ordered_core.sql'
  ),
  'utf8'
);

describe('storefront cluster guide classifier migration', () => {
  it('keeps the classifier stages in bounded migration units', () => {
    // The behavior regression runs through the public RPC in
    // supabase/tests/storefront_cluster_guide_classifier_behavior.sql. This
    // test protects the migration decomposition and optimized plan shape.
    expect(CLASSIFIER_SOURCE.split(/\r?\n/).length).toBeLessThan(300);
    expect(MIGRATION_SOURCE.split(/\r?\n/).length).toBeLessThan(300);
    expect(CLASSIFIER_SOURCE).toContain(
      'explicit_exact_matches AS MATERIALIZED'
    );
    expect(CLASSIFIER_SOURCE).toContain(
      'explicit_exact_winners AS MATERIALIZED'
    );
    expect(CLASSIFIER_SOURCE).toContain(
      'explicit_fallback_matches AS MATERIALIZED'
    );
    expect(CLASSIFIER_SOURCE).toContain(
      'ON candidate.explicit_category = category_name.category_name'
    );
    expect(CLASSIFIER_SOURCE).toMatch(
      /explicit_fallback_matches[\s\S]*pg_catalog\.strpos\(/
    );
    expect(CLASSIFIER_SOURCE).not.toMatch(/LEFT JOIN LATERAL/);
    expect(CLASSIFIER_SOURCE).toContain(
      'WHERE classified.inferred_category_slug = p_requested_category_slug'
    );
    expect(CLASSIFIER_SOURCE).toContain('searchable_posts AS MATERIALIZED');
    expect(CLASSIFIER_SOURCE).toContain(
      "WHEN 'category' THEN candidate.explicit_category"
    );
    expect(CLASSIFIER_SOURCE).toContain('ELSE candidate.semantic_haystack');
    expect(CLASSIFIER_SOURCE).toContain(
      'post_reading_time_minutes integer,\n  search_rank real'
    );
    expect(CLASSIFIER_SOURCE).toContain(
      'classified.search_rank\nFROM classified_posts'
    );
    expect(CLASSIFIER_SOURCE).toContain(
      'LIMIT least(greatest(coalesce(p_effective_limit, 64), 1), 64)'
    );
    expect(MIGRATION_SOURCE).toContain(
      'FROM private.classify_storefront_cluster_guide_candidates_v2('
    );
    expect(MIGRATION_SOURCE).toContain(
      'classified.search_rank DESC,\n    classified.post_published_at DESC,\n    classified.post_slug ASC'
    );
    expect(MIGRATION_SOURCE).toContain(
      'v_requested_category_slug,\n    v_effective_limit'
    );
  });

  it('keeps the bounded public projection and definer isolation intact', () => {
    expect(MIGRATION_SOURCE).toMatch(
      /RETURNS TABLE \([\s\S]*featured_image_url text,[\s\S]*reading_time_minutes integer/
    );
    expect(MIGRATION_SOURCE).toContain('SECURITY DEFINER');
    expect(MIGRATION_SOURCE).toContain("SET search_path TO ''");
    expect(MIGRATION_SOURCE).not.toContain(
      'WHERE classified.inferred_category_slug'
    );
    expect(MIGRATION_SOURCE).toContain('settings.blog_enabled IS TRUE');
    expect(MIGRATION_SOURCE).not.toMatch(/SELECT\s+\*/i);
    expect(CLASSIFIER_SOURCE).toContain('SECURITY DEFINER');
    expect(CLASSIFIER_SOURCE).toContain("SET search_path TO ''");
    expect(CLASSIFIER_SOURCE).not.toMatch(/SELECT\s+\*/i);
  });
});
