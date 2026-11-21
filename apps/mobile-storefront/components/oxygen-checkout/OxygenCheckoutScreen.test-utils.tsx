import { oxygenNativeSession } from '@/services/oxygen/native-session';
import { readOwnedOxygenOrder } from '@/services/oxygen/owned-order';
import { useOxygenWorkflow } from './use-oxygen-workflow';

let mockFocused = true;
let mockWorkflowUnmounts = 0;
const mockFocusSubscribers = new Set<() => void>();
jest.mock('@/components/ui/address-suggestions-portal', () => ({
  AddressSuggestionsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useIsFocused: () => {
    const { useSyncExternalStore } = require('react');
    return useSyncExternalStore(
      (listener: () => void) => {
        mockFocusSubscribers.add(listener);
        return () => mockFocusSubscribers.delete(listener);
      },
      () => mockFocused
    );
  },
}));
jest.mock('./OxygenFormPrimitives', () => ({
  ...jest.requireActual('./OxygenFormPrimitives'),
  useOxygenColors: () => ({ background: 'white', text: 'black' }),
}));
jest.mock('./oxygen-presentation', () => ({
  OxygenAction: ({ label }: { label: string }) => {
    const { Text } = require('react-native');
    return <Text>{label}</Text>;
  },
}));
jest.mock('./OxygenOtp', () => ({
  OxygenOtp: () => {
    const { Text } = require('react-native');
    return <Text>OTP success</Text>;
  },
}));
jest.mock('./OxygenWorkflowBody', () => ({
  OxygenWorkflowBody: ({ snapshot }: { snapshot: { stage: string } }) => {
    const { Text } = require('react-native');
    const { useEffect } = require('react');
    useEffect(
      () => () => {
        mockWorkflowUnmounts++;
      },
      []
    );
    const { OxygenActionFooter } = require('./OxygenActionFooter');
    return (
      <>
        <Text>Saved workflow</Text>
        {snapshot.stage === 'plan_required' ? (
          <OxygenActionFooter>
            <Text>See payment breakdown</Text>
          </OxygenActionFooter>
        ) : null}
      </>
    );
  },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) =>
      select({ user: { id: 'user' }, customer: { id: 'customer' } }),
    { getState: () => ({ customer: { id: 'customer' } }) }
  ),
}));
jest.mock('@/services/oxygen/native-session', () => ({
  oxygenNativeSession: jest.fn(),
}));
jest.mock('@/services/oxygen/owned-order', () => ({
  readOwnedOxygenOrder: jest.fn(),
}));
jest.mock('./use-oxygen-workflow', () => ({ useOxygenWorkflow: jest.fn() }));
export function savedCheckoutFixture() {
  const capabilities = jest.fn();
  const refresh = jest.fn();
  beforeEach(() => {
    capabilities.mockReset();
    refresh.mockReset();
    jest.clearAllMocks();
    mockFocused = true;
    capabilities.mockResolvedValue({ mobileEnabled: false });
    jest.mocked(oxygenNativeSession).mockReturnValue({
      capabilities,
      profile: { merchantId: 'merchant' },
      workflow: jest.fn(),
      client: {},
    } as unknown as ReturnType<typeof oxygenNativeSession>);
    jest.mocked(readOwnedOxygenOrder).mockResolvedValue({
      id: 'order',
      total: 100,
      order_number: 'ORD-STAGING-1',
      payment_method: 'oxygen',
      payment_status: 'pending',
      shipping_status: 'pending',
      prefill: {},
    });
    jest.mocked(useOxygenWorkflow).mockReturnValue({
      snapshot: { stage: 'ready_for_activation' },
      controller: {
        getState: () => ({
          error: null,
          capabilities: { mobileEnabled: false },
        }),
      },
      capabilities: { mobileEnabled: false },
      busy: false,
      error: null,
      refresh,
    } as unknown as ReturnType<typeof useOxygenWorkflow>);
  });
  return { capabilities, refresh };
}

export function setCheckoutFocused(focused: boolean) {
  mockFocused = focused;
  for (const listener of mockFocusSubscribers) listener();
}

export function resetWorkflowUnmounts() {
  mockWorkflowUnmounts = 0;
}

export function workflowUnmountCount() {
  return mockWorkflowUnmounts;
}

export { router } from 'expo-router';
export { OxygenCheckoutScreen } from './OxygenCheckoutScreen';
export { oxygenNativeSession, readOwnedOxygenOrder, useOxygenWorkflow };
