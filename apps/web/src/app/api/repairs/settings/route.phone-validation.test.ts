import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from './route';
import {
  authorizedRepairsAccess,
  makeSettingsAdmin,
  patchSettingsReq,
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

describe('PATCH /api/repairs/settings phone validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRepairsRequest.mockResolvedValue(authorizedRepairsAccess());
  });

  describe('bugfix: partial phone patch with enabled pickup', () => {
    it('rejects clearing contact_phone while persisted pickup stays enabled', async () => {
      const admin = makeSettingsAdmin({
        select: {
          data: {
            merchant_id: 'm-1',
            repair_settings: {
              pickup_enabled: true,
              contact_phone: '09070007000',
              contact_name: 'Repair Center',
            },
          },
          error: null,
        },
      });
      mocks.createClient.mockReturnValue(admin);

      const res = await PATCH(patchSettingsReq({ contact_phone: '' }));

      expect(res.status).toBe(400);
      expect(admin.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid contact_phone patch while persisted pickup stays enabled', async () => {
      const admin = makeSettingsAdmin({
        select: {
          data: {
            merchant_id: 'm-1',
            repair_settings: {
              pickup_enabled: true,
              contact_phone: '09070007000',
            },
          },
          error: null,
        },
      });
      mocks.createClient.mockReturnValue(admin);

      const res = await PATCH(
        patchSettingsReq({ contact_phone: 'not-a-phone' })
      );

      expect(res.status).toBe(400);
      expect(admin.update).not.toHaveBeenCalled();
    });

    it('accepts a valid contact_phone patch while persisted pickup stays enabled', async () => {
      const admin = makeSettingsAdmin({
        select: {
          data: {
            merchant_id: 'm-1',
            repair_settings: {
              pickup_enabled: true,
              contact_phone: '09070007000',
              contact_name: 'Repair Center',
            },
          },
          error: null,
        },
      });
      mocks.createClient.mockReturnValue(admin);

      const res = await PATCH(
        patchSettingsReq({ contact_phone: '08031234567' })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.repairSettings).toMatchObject({
        pickup_enabled: true,
        contact_phone: '08031234567',
        contact_name: 'Repair Center',
      });
    });
  });

  describe('bugfix: short numeric phones that pass isValidPhone after NG dial prefix', () => {
    it('rejects 12345 when courier pickup stays enabled', async () => {
      const admin = makeSettingsAdmin({
        select: {
          data: {
            merchant_id: 'm-1',
            repair_settings: {
              pickup_enabled: true,
              contact_phone: '09070007000',
            },
          },
          error: null,
        },
      });
      mocks.createClient.mockReturnValue(admin);

      const res = await PATCH(patchSettingsReq({ contact_phone: '12345' }));

      expect(res.status).toBe(400);
      expect(admin.update).not.toHaveBeenCalled();
    });

    it('rejects 12345 when persisted settings omit pickup_enabled (DB treats as enabled)', async () => {
      const admin = makeSettingsAdmin({
        select: {
          data: {
            merchant_id: 'm-1',
            repair_settings: {
              contact_phone: '09070007000',
              contact_name: 'Repair Center',
            },
          },
          error: null,
        },
      });
      mocks.createClient.mockReturnValue(admin);

      const res = await PATCH(patchSettingsReq({ contact_phone: '12345' }));

      expect(res.status).toBe(400);
      expect(admin.update).not.toHaveBeenCalled();
    });
  });
});
