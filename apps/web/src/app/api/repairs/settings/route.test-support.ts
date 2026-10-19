import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { vi } from 'vitest';

export function authorizedRepairsAccess() {
  return { ok: true, access: { merchantId: 'm-1' }, supabase: {} };
}

export function makeSettingsAdmin(config: {
  select?: { data: unknown; error: unknown };
  write?: { error: unknown };
}) {
  const update = vi.fn(() => ({
    eq: () => Promise.resolve(config.write ?? { error: null }),
  }));
  const insert = vi.fn(() => Promise.resolve(config.write ?? { error: null }));
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(config.select ?? { data: null, error: null }),
        }),
      }),
      update,
      insert,
    }),
    update,
    insert,
  };
}

export const validRepairSettings = {
  pickup_enabled: true,
  pickup_address: '3 Olayeni Street',
  contact_name: 'Repair Center',
  contact_phone: '09070007000',
  contact_email: 'repairs@ogabassey.com',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
};

export function patchSettingsReq(body: unknown): NextRequest {
  return new Request('https://x/api/repairs/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

export function getSettingsReq(): NextRequest {
  return new Request('https://x') as unknown as NextRequest;
}

export function malformedSettingsReq(): NextRequest {
  return new Request('https://x/api/repairs/settings', {
    method: 'PATCH',
    body: '{ not valid json',
  }) as unknown as NextRequest;
}

export function unauthorizedRepairsResponse(status: number, error: string) {
  return {
    ok: false,
    response: NextResponse.json({ error }, { status }),
  };
}
