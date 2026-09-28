import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_HERO_IMAGE_QUALITY } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';
import { OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST } from '@/config/ogabassey-home-hero-snapshot-manifest';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
  resolveOgabasseyHomeHeroSnapshot,
} from './ogabassey-home-hero-snapshot';

const FLAG = 'NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED';
const ROTATED_URL =
  'https://cdn.ogabassey.com/core-assets/products/new-arrival.jpg';
const PDP_URL =
  'https://cdn.ogabassey.com/core-assets/products/premium-phones/a27-gallery-2.jpg';

// Mirror of SNAPSHOT_WIDTHS in scripts/generate-ogabassey-hero-snapshots.mjs
// (a subset of next.config `deviceSizes`). The pipeline writes these
// descriptors; this test fails if the manifest ever carries anything else.
const PIPELINE_WIDTHS = new Set([640, 750, 828, 1080, 1200]);

describe('resolveOgabasseyHomeHeroSnapshot', () => {
  beforeEach(() => {
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  it('returns null when the flag is off (default CDN path)', () => {
    delete process.env[FLAG];
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
      )
    ).toBeNull();
  });

  it('resolves the committed slide-0 URL to a same-origin snapshot', () => {
    const snapshot = resolveOgabasseyHomeHeroSnapshot(
      OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
      OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.sourceUrl).toBe(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);
    expect(snapshot?.href.startsWith('/_hero/ogabassey/')).toBe(true);
    expect(snapshot?.srcSet).toContain(snapshot?.href.split(' ').pop());
    expect(snapshot?.srcSet).not.toContain('https://');
  });

  it('returns null for rotated content (URL with no manifest entry)', () => {
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        ROTATED_URL
      )
    ).toBeNull();
  });

  it('returns null for non-home imagery (PDP-style URL)', () => {
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        PDP_URL
      )
    ).toBeNull();
  });

  it('returns null for other tenants', () => {
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        'some-other-merchant',
        OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
      )
    ).toBeNull();
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        null,
        OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
      )
    ).toBeNull();
  });

  it('returns null for blank or missing sources', () => {
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        '   '
      )
    ).toBeNull();
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        null
      )
    ).toBeNull();
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        undefined
      )
    ).toBeNull();
  });

  it('normalizes tenant casing', () => {
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT.toUpperCase(),
        OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
      )
    ).not.toBeNull();
  });

  it('keys snapshots to the ogabassey template tenant', () => {
    expect(OGABASSEY_HOME_HERO_SNAPSHOT_TENANT).toBe(OGABASSEY_TEMPLATE_ID);
  });
});

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
      }
    }
  });
});
