import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRILSTASH_DB_READ_TIMEOUT_MS,
  BRILSTASH_FEED_PATH,
  BRILSTASH_FEED_PROBE_TIMEOUT_MS,
  BRILSTASH_FULL_FEED_QUERY,
  BRILSTASH_JSON_MAX_BYTES,
  BRILSTASH_PILOT_LISTING_LIMIT,
} from './brilstash-feed';

// The database refuses a staged payload above this size, so a verifier that
// reads more than the stage allows would only ever see an oversized body.
const STAGING_PAYLOAD_CEILING_BYTES = 524288;
// The reader RPC accepts at most this many rows per page.
const READER_MAX_PAGE_LIMIT = 100;

describe('BrilStash feed configuration', () => {
  it('names a route that exists under the app directory', () => {
    expect(BRILSTASH_FEED_PATH).toMatch(/^\/[a-z0-9/-]+[a-z0-9]$/);
    expect(
      existsSync(
        new URL(`../app${BRILSTASH_FEED_PATH}/route.ts`, import.meta.url)
      )
    ).toBe(true);
  });

  it('keeps the pilot listing limit in step with the staged payload check', () => {
    const storage = readFileSync(
      new URL(
        '../../../../supabase/migrations/20261119010141_brilstash_catalogue_storage.sql',
        import.meta.url
      ),
      'utf8'
    );
    expect(storage).toContain(
      `jsonb_array_length(payload) <= ${BRILSTASH_PILOT_LISTING_LIMIT}`
    );
  });

  it('asks for the whole assortment on the first page with no price floor', () => {
    expect(BRILSTASH_FULL_FEED_QUERY).toEqual({
      page: 1,
      limit: expect.any(Number),
      min_price: 0,
    });
    expect(BRILSTASH_FULL_FEED_QUERY.limit).toBeGreaterThanOrEqual(
      BRILSTASH_PILOT_LISTING_LIMIT
    );
    expect(BRILSTASH_FULL_FEED_QUERY.limit).toBeLessThanOrEqual(
      READER_MAX_PAGE_LIMIT
    );
  });

  it('bounds a verified body by the size the database allows to be staged', () => {
    expect(BRILSTASH_JSON_MAX_BYTES).toBeGreaterThan(0);
    expect(BRILSTASH_JSON_MAX_BYTES).toBeLessThanOrEqual(
      STAGING_PAYLOAD_CEILING_BYTES
    );
  });

  it('lets the route answer with a controlled 503 inside the probe budget', () => {
    expect(BRILSTASH_DB_READ_TIMEOUT_MS).toBeGreaterThan(0);
    expect(BRILSTASH_DB_READ_TIMEOUT_MS).toBeLessThan(
      BRILSTASH_FEED_PROBE_TIMEOUT_MS
    );
  });
});
