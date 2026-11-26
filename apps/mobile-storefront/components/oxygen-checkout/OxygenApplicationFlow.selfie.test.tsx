import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, render, screen } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenApplicationFlow } from './OxygenApplicationFlow';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));
const snapshot = oxygenRuntimeSnapshotSchema.parse({
  workflowId: '11111111-1111-4111-8111-111111111111',
  stage: 'application_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  state: {},
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
});
it('keeps the verified OTP screen while the selfie link loads, with one loading action', async () => {
  const client = {
    draft: { read: jest.fn(), write: jest.fn() },
    bankDetails: jest.fn(),
  } as unknown as OxygenClient;
  const onExecute = jest.fn();
  const pendingSelfie = oxygenRuntimeSnapshotSchema.parse({
    ...snapshot,
    stage: 'kyc_required',
    state: {
      applicationReference: '22222222-2222-4222-8222-222222222222',
      validated: true,
    },
  });
  render(
    <OxygenApplicationFlow
      snapshot={pendingSelfie}
      client={client}
      busy
      scopeKey="owned/selfie"
      onExecute={onExecute}
      selfieRequired
      selfieLoading
      onContinueSelfie={jest.fn()}
    />
  );
  await act(async () => {});
  expect(screen.getByText('Code verified')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Opening camera…' }).props
      .accessibilityState
  ).toEqual({ busy: true, disabled: true });
  expect(screen.queryByText('Opening facial verification')).toBeNull();
  expect(onExecute).not.toHaveBeenCalled();
  expect(client.draft.read).not.toHaveBeenCalled();
});
