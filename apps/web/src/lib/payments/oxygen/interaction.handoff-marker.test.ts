import { describe, expect, it } from 'vitest';
import {
  clearAllOxygenHandoffMarkers,
  clearOxygenHandoffMarker,
  OXYGEN_HANDOFF_MARKER_PREFIX,
  OXYGEN_HANDOFF_MARKER_TTL_MS,
  type OxygenMarkerStorage,
  oxygenHandoffMarkerKey,
  readOxygenHandoffMarker,
  writeOxygenHandoffMarker,
} from './interaction';
import {
  FakeMarkerStorage,
  FIXTURE_ORDER_ID,
} from './interaction.test-helpers';

describe('handoff marker', () => {
  const NOW = 1_760_000_000_000;

  it('pins the per-order key shape and the 24h TTL', () => {
    expect(OXYGEN_HANDOFF_MARKER_PREFIX).toBe('baci_oxygen_handoff:');
    expect(OXYGEN_HANDOFF_MARKER_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID)).toBe(
      `baci_oxygen_handoff:${FIXTURE_ORDER_ID}`
    );
  });

  it('round-trips a written marker with orderId + createdAt only', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt: NOW,
    });
    expect(
      Object.keys(
        JSON.parse(
          storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID)) ?? '{}'
        )
      ).sort()
    ).toEqual(['createdAt', 'orderId']);
  });

  it('returns null when no marker is stored', () => {
    expect(
      readOxygenHandoffMarker(new FakeMarkerStorage(), FIXTURE_ORDER_ID, NOW)
    ).toBeNull();
  });

  it('last-write-wins for same-order writes (multi-tab)', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW - 1000);
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt: NOW,
    });
  });

  it('discards corrupt JSON (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID), '{nope');
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('discards an order-key mismatch (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(
      oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
      JSON.stringify({ orderId: 'another-order', createdAt: NOW })
    );
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('discards a non-object payload (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(
      oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
      JSON.stringify(['orderId', NOW])
    );
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('discards a non-numeric createdAt (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    for (const createdAt of ['yesterday', Number.NaN, null, {}]) {
      storage.setItem(
        oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
        JSON.stringify({ orderId: FIXTURE_ORDER_ID, createdAt })
      );
      expect(
        readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)
      ).toBeNull();
      expect(
        storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
      ).toBeNull();
    }
  });

  it('discards an expired marker past the 24h TTL', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(
      oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
      JSON.stringify({
        orderId: FIXTURE_ORDER_ID,
        createdAt: NOW - OXYGEN_HANDOFF_MARKER_TTL_MS - 1,
      })
    );
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('keeps a marker exactly at the TTL boundary', () => {
    const storage = new FakeMarkerStorage();
    const createdAt = NOW - OXYGEN_HANDOFF_MARKER_TTL_MS;
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, createdAt);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt,
    });
  });

  it('accepts a future createdAt (clock skew fails open to revalidation)', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW + 60_000);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt: NOW + 60_000,
    });
  });

  it('clears a single order marker without touching siblings', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    writeOxygenHandoffMarker(storage, 'sibling-order', NOW);
    clearOxygenHandoffMarker(storage, FIXTURE_ORDER_ID);
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey('sibling-order'))
    ).not.toBeNull();
  });

  it('prefix-clears every handoff marker and leaves foreign keys alone', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    writeOxygenHandoffMarker(storage, 'sibling-order', NOW);
    storage.setItem('storefront-checkout-idempotency', 'keep-me');
    clearAllOxygenHandoffMarkers(storage);
    expect(storage.keys()).toEqual(['storefront-checkout-idempotency']);
  });

  it('ignores blank order ids for every marker op', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, '', NOW);
    expect(storage.keys()).toEqual([]);
    expect(readOxygenHandoffMarker(storage, '', NOW)).toBeNull();
    expect(() => clearOxygenHandoffMarker(storage, '')).not.toThrow();
  });

  it('treats null storage as absent markers everywhere without throwing', () => {
    expect(() =>
      writeOxygenHandoffMarker(null, FIXTURE_ORDER_ID, NOW)
    ).not.toThrow();
    expect(readOxygenHandoffMarker(null, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(() =>
      clearOxygenHandoffMarker(null, FIXTURE_ORDER_ID)
    ).not.toThrow();
    expect(() => clearAllOxygenHandoffMarkers(null)).not.toThrow();
  });

  it('survives throwing storage without breaking the flow', () => {
    const throwing: OxygenMarkerStorage = {
      get length(): number {
        throw new Error('denied');
      },
      key: () => {
        throw new Error('denied');
      },
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() =>
      writeOxygenHandoffMarker(throwing, FIXTURE_ORDER_ID, NOW)
    ).not.toThrow();
    expect(readOxygenHandoffMarker(throwing, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(() =>
      clearOxygenHandoffMarker(throwing, FIXTURE_ORDER_ID)
    ).not.toThrow();
    expect(() => clearAllOxygenHandoffMarkers(throwing)).not.toThrow();
  });

  it('prefix-clear tolerates unreadable slots and unremovable keys', () => {
    const flaky: OxygenMarkerStorage = {
      get length(): number {
        return 2;
      },
      key: (index: number) => {
        if (index === 0) throw new Error('unreadable slot');
        return `${OXYGEN_HANDOFF_MARKER_PREFIX}stuck`;
      },
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('locked');
      },
    };
    expect(() => clearAllOxygenHandoffMarkers(flaky)).not.toThrow();
  });
});
