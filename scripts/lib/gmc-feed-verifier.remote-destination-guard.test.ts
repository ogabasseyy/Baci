import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DestinationLookupFn as DnsLookupFn } from './remote-destination-gate';

// Keeps DNS hermetic while proving the default-forwarding contract: when a
// caller omits lookupFn, the gate must receive undefined (so it falls back
// to the production resolver) rather than a stale closure. The mock records
// what was forwarded and substitutes a public documentation IP.
const forwardedLookups: Array<DestinationLookupFn | undefined> = [];
vi.mock('./remote-destination-gate', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./remote-destination-gate')>();
  const publicLookup: DestinationLookupFn = async () => [
    { address: '93.184.216.1', family: 4 },
  ];
  return {
    ...actual,
    resolvePinnedDestination: (url: string, lookupFn?: DestinationLookupFn) => {
      forwardedLookups.push(lookupFn);
      return actual.resolvePinnedDestination(url, lookupFn ?? publicLookup);
    },
  };
});
import { type FetchFn, verifyRemoteImage } from './gmc-feed-verifier';

/** Builds a partial Response matching only what verifyRemoteImage inspects. */
function fakeResponse(props: {
  ok: boolean;
  status: number;
  headers: Headers;
}): Response {
  return props as unknown as Response;
}

/** Resolves every hostname to a public documentation IP. */
const publicLookup: DnsLookupFn = async () => [
  { address: '93.184.216.1', family: 4 },
];

// ---------- verifyRemoteImage: remote destination guard ----------
describe('verifyRemoteImage', () => {
  it('rejects private destinations without issuing a request', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const result = await verifyRemoteImage('http://169.254.169.254/latest/meta-data', fetchFn);
    expect(result.status).toBe('invalid');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects HTTP redirects instead of following them', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      fakeResponse({ ok: false, status: 302, headers: new Headers({ location: 'http://127.0.0.1' }) })
    );
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      publicLookup
    );
    expect(result.status).toBe('invalid');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://images.example.com/phone.jpg',
      expect.objectContaining({ redirect: 'manual' })
    );
  });
  it('rejects hostnames that resolve to private addresses without fetching', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const lookupFn: DnsLookupFn = async () => [{ address: '10.0.0.5', family: 4 }];
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      lookupFn
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('non-public address 10.0.0.5');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 resolutions by their embedded address', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const lookupFn: DnsLookupFn = async () => [{ address: '::ffff:7f00:1', family: 6 }];
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      lookupFn
    );
    expect(result.status).toBe('invalid');
    expect(result.failure_reason).toContain('non-public address ::ffff:7f00:1');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('retries verification when DNS resolution fails', async () => {
    const fetchFn = vi.fn<FetchFn>();
    const lookupFn: DnsLookupFn = async () => {
      throw new Error('ENOTFOUND images.example.com');
    };
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      lookupFn
    );
    expect(result.status).toBe('pending_verification');
    expect(result.failure_reason).toContain('DNS resolution failed');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches through the pinned dispatcher from the destination gate', async () => {
    const seen: unknown[] = [];
    const fetchFn = vi.fn<FetchFn>(async (input, init) => {
      seen.push(init);
      return fakeResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      });
    });
    const result = await verifyRemoteImage(
      'https://images.example.com/phone.jpg',
      fetchFn,
      publicLookup
    );
    expect(result.status).toBe('verified');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({ dispatcher: expect.anything() });
  });
});
