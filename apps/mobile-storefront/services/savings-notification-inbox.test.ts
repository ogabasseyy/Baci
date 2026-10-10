import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<() => Promise<unknown>>();

jest.mock('@/lib/customer-savings-api', () => ({
  getCustomerSavingsApiClient: () => ({ fetchJson: mockFetchJson }),
}));

const {
  fetchSavingsNotificationInbox,
  markSavingsNotificationRead,
  updateSavingsNotificationPreferences,
} =
  require('./savings-notification-inbox') as typeof import('./savings-notification-inbox');

const preferences = {
  encouragementEnabled: true,
  interestAlertsEnabled: true,
  quietHoursEnd: '08:00',
  quietHoursStart: '22:00',
  timeZone: 'Africa/Lagos',
  weeklySummaryEnabled: false,
};

describe('savings notification inbox service', () => {
  beforeEach(() => {
    mockFetchJson.mockReset();
  });

  it('loads only server-issued notifications for the requested merchant', async () => {
    mockFetchJson.mockResolvedValue({
      notifications: [
        {
          body: 'Your savings interest has been credited.',
          createdAt: '2026-09-25T10:00:00.000Z',
          goalId: '00000000-0000-4000-8000-000000000002',
          id: '00000000-0000-4000-8000-000000000001',
          readAt: null,
          title: 'Interest credited',
          type: 'savings_interest_credited',
        },
      ],
      deliveryEnabled: true,
      preferences,
    });

    await expect(
      fetchSavingsNotificationInbox({
        merchantId: '00000000-0000-4000-8000-000000000010',
      })
    ).resolves.toMatchObject({
      deliveryEnabled: true,
      notifications: [expect.objectContaining({ title: 'Interest credited' })],
      preferences,
    });

    expect(mockFetchJson).toHaveBeenCalledWith({
      path: '/api/storefront/customer/savings/notifications',
      query: { merchantId: '00000000-0000-4000-8000-000000000010' },
    });
  });

  it('persists a read notification through the authenticated merchant-scoped PATCH', async () => {
    mockFetchJson.mockResolvedValue({ success: true });

    await expect(
      markSavingsNotificationRead({
        merchantId: '00000000-0000-4000-8000-000000000010',
        notificationId: '00000000-0000-4000-8000-000000000001',
      })
    ).resolves.toEqual({ success: true });

    expect(mockFetchJson).toHaveBeenCalledWith({
      body: {
        merchantId: '00000000-0000-4000-8000-000000000010',
        readNotificationId: '00000000-0000-4000-8000-000000000001',
      },
      method: 'PATCH',
      path: '/api/storefront/customer/savings/notifications',
    });
  });

  it('sends an opt-in weekly digest and the server preference timezone unchanged', async () => {
    mockFetchJson.mockResolvedValue({ success: true });

    await updateSavingsNotificationPreferences({
      merchantId: '00000000-0000-4000-8000-000000000010',
      preferences: {
        timeZone: 'Africa/Lagos',
        weeklySummaryEnabled: true,
      },
    });

    expect(mockFetchJson).toHaveBeenCalledWith({
      body: {
        merchantId: '00000000-0000-4000-8000-000000000010',
        preferences: {
          timeZone: 'Africa/Lagos',
          weeklySummaryEnabled: true,
        },
      },
      method: 'PATCH',
      path: '/api/storefront/customer/savings/notifications',
    });
  });

  it('rejects malformed goal and notification identifiers before rendering or persisting them', async () => {
    mockFetchJson.mockResolvedValue({
      notifications: [
        {
          body: 'Bad payload',
          createdAt: '2026-09-25T10:00:00.000Z',
          goalId: 'not-a-uuid',
          id: 'also-not-a-uuid',
          readAt: null,
          title: 'Bad notification',
          type: 'savings_interest_credited',
        },
      ],
      preferences,
    });

    await expect(
      fetchSavingsNotificationInbox({
        merchantId: '00000000-0000-4000-8000-000000000010',
      })
    ).rejects.toThrow();
  });

  it('defaults a legacy inbox response without deliveryEnabled to false', async () => {
    mockFetchJson.mockResolvedValue({ notifications: [], preferences });

    await expect(
      fetchSavingsNotificationInbox({
        merchantId: '00000000-0000-4000-8000-000000000010',
      })
    ).resolves.toMatchObject({ deliveryEnabled: false });
  });
});
