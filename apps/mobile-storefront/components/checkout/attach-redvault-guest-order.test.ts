import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { trackError } from '@/services/analytics';
import { attachRedvaultGuestOrderAfterSignup } from './attach-redvault-guest-order';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn(), signOut: jest.fn() },
    rpc: jest.fn(),
  },
}));
jest.mock('@/services/analytics', () => ({
  trackError: jest.fn(),
}));
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockSignOut = supabase.auth.signOut as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockAlert = Alert.alert as jest.Mock;
const mockTrackError = trackError as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue({});
});

describe('attachRedvaultGuestOrderAfterSignup', () => {
  it('skips the attach when no session was established', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await attachRedvaultGuestOrderAfterSignup({
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('skips the attach when the tracking token is missing', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });

    await attachRedvaultGuestOrderAfterSignup({ orderId: 'order-rv' });

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('attaches the guest order under the new session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });
    mockRpc.mockResolvedValue({ data: true, error: null });

    await attachRedvaultGuestOrderAfterSignup({
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'attach_redvault_guest_application_to_customer',
      { p_order_id: 'order-rv', p_tracking_token: 'track-rv' }
    );
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('signs back out when the attach reports not-attached without an error', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });
    mockRpc.mockResolvedValue({ data: false, error: null });

    await attachRedvaultGuestOrderAfterSignup({
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith(
      'Account sync failed',
      expect.any(String)
    );
  });

  it('signs back out to restore the guest context when the attach fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: {} } } });
    mockRpc.mockResolvedValue({ error: { message: 'identity_required' } });

    await attachRedvaultGuestOrderAfterSignup({
      orderId: 'order-rv',
      trackingToken: 'track-rv',
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockTrackError).toHaveBeenCalledWith(
      'redvault_guest_attach',
      expect.any(String)
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'Account sync failed',
      expect.any(String)
    );
  });
});
