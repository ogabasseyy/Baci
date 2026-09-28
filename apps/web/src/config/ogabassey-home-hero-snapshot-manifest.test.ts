import { describe, expect, it } from 'vitest';
import { MOBILE_HERO_IMAGE_QUALITY } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST } from './ogabassey-home-hero-snapshot-manifest';

// Mirror of SNAPSHOT_WIDTHS in scripts/lib/ogabassey-hero-snapshot-config.mjs
// (the emitted mobile ladder from the 256 floor; tiers >= 1440 excluded as
// unreachable under the 767px media cap). The pipeline writes these
// descriptors; this test fails if the manifest ever carries anything else.
const PIPELINE_WIDTHS = new Set([256, 384, 640, 750, 828, 1080, 1200]);

describe('hero snapshot manifest integrity', () => {
  it('covers the committed first-flush URL', () => {
    const entries =
      OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST[OGABASSEY_TEMPLATE_ID];
    expect(entries?.[OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL]).toBeDefined();
  });

  it('holds well-formed same-origin entries at hero quality', () => {
    for (const [slug, entries] of Object.entries(
      OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST
    )) {
      expect(slug.length).toBeGreaterThan(0);
      for (const [key, entry] of Object.entries(entries)) {
        // Key and payload agree: the runtime re-checks this before use.
        expect(key).toBe(entry.sourceUrl);
        // Same quality the CDN AVIF tier serves — never a blurrier twin.
        expect(entry.quality).toBe(MOBILE_HERO_IMAGE_QUALITY);
        // Every candidate is an app-local snapshot path.
        const candidates = entry.srcSet.split(',').map((part) => part.trim());
        expect(candidates.length).toBeGreaterThan(0);
        const files: string[] = [];
        const descriptors: number[] = [];
        for (const candidate of candidates) {
          const [file, descriptor] = candidate.split(/\s+/);
          expect(file.startsWith(`/_hero/${slug}/`)).toBe(true);
          expect(descriptor).toMatch(/^\d+w$/);
          const width = Number(descriptor.slice(0, -1));
          expect(PIPELINE_WIDTHS.has(width)).toBe(true);
          files.push(file);
          descriptors.push(width);
        }
        expect([...descriptors].sort((a, b) => a - b)).toEqual(entry.widths);
        expect(files).toContain(entry.href);
        expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(Number.isFinite(Date.parse(entry.bakedAt))).toBe(true);
      }
    }
  });
});
