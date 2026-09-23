import { describe, expect, it } from 'vitest';
import { resolveJumiaIntegrationId } from './resolve-jumia-integration-id';

describe('resolveJumiaIntegrationId', () => {
  it('uses a valid integration selected by the scoped orders link', () => {
    expect(
      resolveJumiaIntegrationId(
        [{ id: 'integration-1' }, { id: 'integration-2' }],
        'integration-2'
      )
    ).toBe('integration-2');
  });

  it('rejects an unknown scoped integration instead of choosing another shop', () => {
    expect(
      resolveJumiaIntegrationId(
        [{ id: 'integration-1' }, { id: 'integration-2' }],
        'stale-integration'
      )
    ).toBeNull();
  });

  it('falls back to the only active integration when no scope is requested', () => {
    expect(resolveJumiaIntegrationId([{ id: 'integration-1' }], null)).toBe(
      'integration-1'
    );
  });

  it('resolves the row shop integration instead of the link scope', () => {
    expect(
      resolveJumiaIntegrationId(
        [
          { id: 'integration-a', shop_id: 'shop-a' },
          { id: 'integration-b', shop_id: 'shop-b' },
        ],
        'integration-a',
        'shop-b'
      )
    ).toBeNull();
  });

  it('honors the scoped link when it owns the row shop', () => {
    expect(
      resolveJumiaIntegrationId(
        [
          { id: 'integration-a', shop_id: 'shop-a' },
          { id: 'integration-b', shop_id: 'shop-b' },
        ],
        'integration-b',
        'shop-b'
      )
    ).toBe('integration-b');
  });

  it('falls back to the only integration of the row shop', () => {
    expect(
      resolveJumiaIntegrationId(
        [
          { id: 'integration-a', shop_id: 'shop-a' },
          { id: 'integration-b', shop_id: 'shop-b' },
        ],
        null,
        'shop-b'
      )
    ).toBe('integration-b');
  });

  it('returns null when no integration serves the row shop', () => {
    expect(
      resolveJumiaIntegrationId(
        [{ id: 'integration-a', shop_id: 'shop-a' }],
        null,
        'shop-unknown'
      )
    ).toBeNull();
  });
});
