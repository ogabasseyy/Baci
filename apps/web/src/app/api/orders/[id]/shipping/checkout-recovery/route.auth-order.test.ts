import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: auth }));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));

// Observe await without timers or unhandled rejected promises. A proxy forces
// normal then lookup rather than native Promise await's internal fast path.
function routeParams(events: string[]) {
  return new Proxy(Promise.resolve({ id: 'not-a-uuid' }), {
    get(target, key, receiver) {
      if (key === 'then') {
        events.push('params');
        return target.then.bind(target);
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

describe('checkout recovery authentication boundary', () => {
  it('returns unauthorized without resolving route parameters', async () => {
    const events: string[] = [];
    auth.mockImplementation(async () => {
      events.push('auth');
      return { user: null };
    });
    const result = await POST(new NextRequest('https://example.test'), {
      params: routeParams(events),
    });
    expect(result.status).toBe(401);
    expect(events).toEqual(['auth']);
  });

  it('resolves and validates parameters only after successful authentication', async () => {
    const events: string[] = [];
    auth.mockImplementation(async () => {
      events.push('auth');
      return { user: { id: 'owner' }, supabase: {} };
    });
    const result = await POST(new NextRequest('https://example.test'), {
      params: routeParams(events),
    });
    expect(result.status).toBe(400);
    expect(events).toEqual(['auth', 'params']);
  });
});
