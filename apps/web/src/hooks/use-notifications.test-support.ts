import { vi } from 'vitest';
import type {
  ActiveBanner,
  MerchantNotificationWithDetails,
} from '@/types/notifications';
import type { MerchantContextType, MerchantData } from './merchant/types';

export const notificationMocks = {
  channel: {
    on: vi.fn(),
    subscribe: vi.fn(),
  },
  fetchWithCsrf: vi.fn(),
  getMerchant: vi.fn(),
  getMerchantSafe: vi.fn(),
  removeChannel: vi.fn(),
  rpc: vi.fn(),
  supabaseChannel: vi.fn(),
};

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: notificationMocks.fetchWithCsrf,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    channel: notificationMocks.supabaseChannel,
    removeChannel: notificationMocks.removeChannel,
    rpc: notificationMocks.rpc,
  })),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: notificationMocks.getMerchant,
  useMerchantSafe: notificationMocks.getMerchantSafe,
}));

function merchantContext(merchant: MerchantData | null): MerchantContextType {
  return {
    basePath: '/',
    hasPermission: vi.fn(),
    loading: false,
    merchant,
    navigationCategories: [],
    reloadMerchant: vi.fn(),
    routingMode: 'path',
    staffAccess: {
      isOwner: true,
      isStaff: false,
      permissions: { full_access: { all: true } },
      role: null,
    },
    updateMerchant: vi.fn(),
  };
}

export function setMerchant(merchantId: string | null = 'merchant-123') {
  notificationMocks.getMerchant.mockReturnValue(
    merchantContext(merchantId ? ({ id: merchantId } as MerchantData) : null)
  );
}

export function setSafeMerchant(merchantId: string | null = 'merchant-123') {
  notificationMocks.getMerchantSafe.mockReturnValue(
    merchantId ? merchantContext({ id: merchantId } as MerchantData) : null
  );
}

export function resetNotificationHookMocks() {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  notificationMocks.channel.on.mockReturnValue(notificationMocks.channel);
  notificationMocks.channel.subscribe.mockReturnValue(
    notificationMocks.channel
  );
  notificationMocks.supabaseChannel.mockReturnValue(notificationMocks.channel);
  notificationMocks.rpc.mockResolvedValue({ data: [], error: null });
  setMerchant();
  setSafeMerchant();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({
        cursor: null,
        data: [],
        has_more: false,
        unread_count: 0,
      }),
      ok: true,
    })
  );
  notificationMocks.fetchWithCsrf.mockImplementation(
    (...args: Parameters<typeof fetch>) => global.fetch(...args)
  );
}

export function notificationRow(
  overrides: Partial<MerchantNotificationWithDetails> = {}
): MerchantNotificationWithDetails {
  return {
    banner_dismissed_at: null,
    created_at: '2026-02-10T12:00:00Z',
    dismissed_at: null,
    id: 'notif-1',
    merchant_id: 'merchant-123',
    notification: {
      action_label: null,
      action_url: null,
      channels: ['in_app'],
      created_at: '2026-02-10T12:00:00Z',
      created_by: 'admin-1',
      delivery_attempts: 0,
      delivery_last_error: null,
      delivery_state: 'sent',
      expires_at: null,
      id: 'n1',
      is_system: false,
      message: 'Test message',
      notification_type: 'info',
      priority: 'normal',
      scheduled_for: null,
      sent_at: '2026-02-10T12:00:00Z',
      target_merchant_ids: ['merchant-123'],
      target_segment: null,
      target_type: 'specific',
      template_id: null,
      title: 'Test notification',
    },
    notification_id: 'n1',
    read_at: null,
    ...overrides,
  };
}

export function activeBanner(
  overrides: Partial<ActiveBanner> = {}
): ActiveBanner {
  return {
    action_label: 'View',
    action_url: '/action',
    created_at: '2026-02-10T12:00:00Z',
    id: 'banner-1',
    message: 'Banner message',
    notification_id: 'n1',
    notification_type: 'warning',
    priority: 'high',
    title: 'Banner',
    ...overrides,
  };
}

export function notificationResponse(
  data: MerchantNotificationWithDetails[],
  options: {
    cursor?: string | null;
    hasMore?: boolean;
    unreadCount?: number;
  } = {}
) {
  return {
    cursor: options.cursor ?? null,
    data,
    has_more: options.hasMore ?? false,
    unread_count: options.unreadCount ?? 0,
  };
}
