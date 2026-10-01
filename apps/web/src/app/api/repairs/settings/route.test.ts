import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PATCH } from './route';
import {
  authorizedRepairsAccess,
  getSettingsReq,
  makeSettingsAdmin,
  malformedSettingsReq,
  patchSettingsReq,
  unauthorizedRepairsResponse,
  validRepairSettings,
} from './route.test-support';

const mocks = vi.hoisted(() => ({
  authorizeRepairsRequest: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/repairs/catalog-admin-auth', () => ({
  authorizeRepairsRequest: mocks.authorizeRepairsRequest,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createClient: mocks.createClient,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/lib/merchant-feature-settings-defaults', () => ({
  merchantFeatureSettingsDefaults: {
    buildFields: () => ({ loyalty_enabled: false }),
  },
}));

describe('GET /api/repairs/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRepairsRequest.mockResolvedValue(authorizedRepairsAccess());
  });

  it('returns 401 when unauthorized', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      unauthorizedRepairsResponse(401, 'Unauthorized')
    );
    const res = await GET(getSettingsReq());
    expect(res.status).toBe(401);
  });

  it('returns the stored settings', async () => {
    mocks.createClient.mockReturnValue(
      makeSettingsAdmin({
        select: {
          data: {
            repair_settings: validRepairSettings,
            repairs_catalog_enabled: true,
          },
          error: null,
        },
      })
    );
    const res = await GET(getSettingsReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repairSettings).toEqual(validRepairSettings);
    expect(body.repairsCatalogEnabled).toBe(true);
  });

  it('returns 500 when the settings query fails', async () => {
    mocks.createClient.mockReturnValue(
      makeSettingsAdmin({ select: { data: null, error: { message: 'boom' } } })
    );
    const res = await GET(getSettingsReq());
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/repairs/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRepairsRequest.mockResolvedValue(authorizedRepairsAccess());
  });

  it('returns 403 when the caller lacks repairs.edit', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      unauthorizedRepairsResponse(403, 'Permission denied')
    );
    const res = await PATCH(patchSettingsReq(validRepairSettings));
    expect(res.status).toBe(403);
  });

  it('rejects an invalid email', async () => {
    const res = await PATCH(
      patchSettingsReq({ ...validRepairSettings, contact_email: 'nope' })
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed request body', async () => {
    const res = await PATCH(malformedSettingsReq());
    expect(res.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('returns 500 when the settings lookup fails', async () => {
    mocks.createClient.mockReturnValue(
      makeSettingsAdmin({ select: { data: null, error: { message: 'boom' } } })
    );
    const res = await PATCH(patchSettingsReq(validRepairSettings));
    expect(res.status).toBe(500);
  });

  it('updates an existing settings row', async () => {
    const admin = makeSettingsAdmin({
      select: { data: { merchant_id: 'm-1' }, error: null },
    });
    mocks.createClient.mockReturnValue(admin);
    const res = await PATCH(patchSettingsReq(validRepairSettings));
    expect(res.status).toBe(200);
    expect(admin.update).toHaveBeenCalled();
    expect(admin.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/repairs');
  });

  it('merges partial settings into the existing private settings JSON', async () => {
    const admin = makeSettingsAdmin({
      select: {
        data: {
          merchant_id: 'm-1',
          repair_settings: {
            pickup_address: '3 Olayeni Street',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
            contact_name: 'Repair Center',
          },
        },
        error: null,
      },
    });
    mocks.createClient.mockReturnValue(admin);

    const res = await PATCH(
      patchSettingsReq({ pickup_enabled: true, contact_phone: '09070007000' })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(admin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        repair_settings: {
          pickup_address: '3 Olayeni Street',
          city: 'Ikeja',
          state: 'Lagos',
          country: 'Nigeria',
          contact_name: 'Repair Center',
          pickup_enabled: true,
          contact_phone: '09070007000',
        },
      })
    );
    expect(body.repairSettings).toMatchObject({
      pickup_address: '3 Olayeni Street',
      pickup_enabled: true,
      contact_phone: '09070007000',
    });
  });

  it('clears a stored contact email when the merchant submits a blank value', async () => {
    const admin = makeSettingsAdmin({
      select: {
        data: {
          merchant_id: 'm-1',
          repair_settings: {
            pickup_enabled: false,
            contact_email: 'repairs@ogabassey.com',
          },
        },
        error: null,
      },
    });
    mocks.createClient.mockReturnValue(admin);

    const res = await PATCH(patchSettingsReq({ contact_email: '' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(admin.update).toHaveBeenCalledWith(
      expect.objectContaining({
        repair_settings: {
          pickup_enabled: false,
          contact_email: null,
        },
      })
    );
    expect(body.repairSettings).toEqual({
      pickup_enabled: false,
      contact_email: null,
    });
  });

  it('inserts defaults when no settings row exists yet', async () => {
    const admin = makeSettingsAdmin({ select: { data: null, error: null } });
    mocks.createClient.mockReturnValue(admin);
    const res = await PATCH(patchSettingsReq(validRepairSettings));
    expect(res.status).toBe(200);
    expect(admin.insert).toHaveBeenCalled();
  });

  it('returns 500 when the write fails', async () => {
    mocks.createClient.mockReturnValue(
      makeSettingsAdmin({
        select: { data: { merchant_id: 'm-1' }, error: null },
        write: { error: { message: 'boom' } },
      })
    );
    const res = await PATCH(patchSettingsReq(validRepairSettings));
    expect(res.status).toBe(500);
  });
});
