import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, render } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenApplicationFlow } from './OxygenApplicationFlow';
import type { OxygenApplicationStepsProps } from './OxygenApplicationSteps';

let mockStepProps: OxygenApplicationStepsProps;
jest.mock('./OxygenApplicationSteps', () => ({
  OxygenApplicationSteps: (props: OxygenApplicationStepsProps) => {
    mockStepProps = props;
    return null;
  },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
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

it('reports and clears consentError when submitting without consent', async () => {
  const client = {
    draft: {
      read: jest.fn().mockResolvedValue({
        version: 3,
        draft: {
          step: 2,
          fields: {
            first_name: 'Test',
            last_name: 'Customer',
            email: 'test@example.com',
            bvn: '12345678901',
            nin: '12345678901',
            date_of_birth: '1990-01-01',
            bank_code: '058',
            account_number: '0123456789',
            employment_status: 'EMPLOYED',
            salary_amount: '250000',
            salary_date: '25',
          },
        },
      }),
      write: jest.fn(),
    },
    bankDetails: jest
      .fn()
      .mockImplementation(async ({ action }: { action: string }) =>
        action === 'banks'
          ? { banks: [{ code: '058', name: 'GT Bank' }] }
          : { accountName: 'TEST CUSTOMER' }
      ),
  } as unknown as OxygenClient;
  render(
    <OxygenApplicationFlow
      snapshot={{ ...snapshot, checkoutPhone: '08012345678' }}
      client={client}
      busy={false}
      scopeKey="consent/check"
      onExecute={jest.fn()}
    />
  );
  await act(async () => {});
  await act(async () => mockStepProps.onSubmit());
  expect(mockStepProps.consentError).toBe('Accept Oxygen’s terms to continue.');
  expect(mockStepProps.error).toBe('Accept Oxygen’s terms before continuing.');
  act(() => mockStepProps.onConsent(true));
  expect(mockStepProps.consentError).toBeNull();
  expect(mockStepProps.error).toBeNull();
});
