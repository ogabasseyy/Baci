import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenApplicationFlow } from './OxygenApplicationFlow';

jest.mock('./OxygenApplicationSteps', () => ({
  OxygenApplicationSteps: () => {
    const { Text } = require('react-native');
    return <Text>Identity details</Text>;
  },
}));
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
function application(read: jest.Mock) {
  const client = {
    draft: { read, write: jest.fn() },
    bankDetails: jest.fn().mockResolvedValue({ banks: [] }),
  } as unknown as OxygenClient;
  return (
    <OxygenApplicationFlow
      snapshot={snapshot}
      client={client}
      busy={false}
      onExecute={jest.fn()}
      scopeKey="owned/application"
    />
  );
}

it('shows a noninteractive form loading state until restoration completes', async () => {
  let finish: (value: { version: number; draft: null }) => void = () => {};
  const read = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(application(read));
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Loading your application')).toBeTruthy();
  expect(screen.queryByText('Restoring saved application…')).toBeNull();
  await act(async () => finish({ version: 0, draft: null }));
  expect(screen.getByText('Identity details')).toBeTruthy();
  expect(screen.queryByLabelText('Loading your application')).toBeNull();
});

it('shows retry only after restoration fails and removes it during the retry', async () => {
  const read = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => new Promise(() => {}));
  render(application(read));
  const retry = await screen.findByRole('button', { name: 'Try again' });
  fireEvent.press(retry);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Loading your application')).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
});
