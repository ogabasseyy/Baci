import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from '@/config/ogabassey-home-hero-snapshot-tenant';
import { resolveOgabasseyHomeHeroSnapshot } from './ogabassey-home-hero-snapshot';

const FLAG = 'NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED';
const ROTATED_URL =
  'https://cdn.ogabassey.com/core-assets/products/new-arrival.jpg';
const PDP_URL =
  'https://cdn.ogabassey.com/core-assets/products/premium-phones/a27-gallery-2.jpg';

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
});
