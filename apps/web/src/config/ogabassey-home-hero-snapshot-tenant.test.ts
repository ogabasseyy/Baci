import { describe, expect, it } from 'vitest';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from './ogabassey-home-hero-snapshot-tenant';

describe('OGABASSEY_HOME_HERO_SNAPSHOT_TENANT', () => {
  it('keys snapshots to the ogabassey template tenant', () => {
    expect(OGABASSEY_HOME_HERO_SNAPSHOT_TENANT).toBe(OGABASSEY_TEMPLATE_ID);
  });
});
