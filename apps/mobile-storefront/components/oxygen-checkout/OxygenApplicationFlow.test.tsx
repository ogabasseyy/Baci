import { oxygenRuntimeSnapshotSchema } from '@baci/shared/oxygen';
import { act, render, screen } from '@testing-library/react-native';
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
describe('native application draft restoration', () => {
  it('keeps fields editable while a background draft save is pending', async () => {
    jest.useFakeTimers();
    let finish: (value: { version: number }) => void = () => {};
    const write = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write,
      },
      bankDetails: jest.fn().mockResolvedValue({ banks: [] }),
    } as unknown as OxygenClient;
    try {
      render(
        <OxygenApplicationFlow
          snapshot={snapshot}
          client={client}
          busy={false}
          scopeKey="typing/owner"
          onExecute={jest.fn()}
        />
      );
      await act(async () => {});
      act(() => mockStepProps.onChange({ bvn: '123' }));
      await act(async () => {
        jest.advanceTimersByTime(700);
      });
      expect(write).not.toHaveBeenCalled();
      act(() => mockStepProps.onFieldBlur?.());
      expect(write).toHaveBeenCalledTimes(1);
      expect(mockStepProps.busy).toBe(false);
      await act(async () => {
        finish({ version: 1 });
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('restores fields without requiring upfront proof and requires fresh consent', async () => {
    const fields = {
      home_street: 'Example Road',
      home_state: 'Lagos',
      first_name: 'Test',
    };
    const client = {
      draft: {
        read: jest
          .fn()
          .mockResolvedValue({ version: 3, draft: { step: 2, fields } }),
        write: jest.fn(),
      },
      bankDetails: jest
        .fn()
        .mockResolvedValue({ banks: [{ code: '001', name: 'Access' }] }),
    } as unknown as OxygenClient;
    render(
      <OxygenApplicationFlow
        snapshot={snapshot}
        client={client}
        busy={false}
        scopeKey="user/merchant/workflow"
        onExecute={jest.fn()}
      />
    );
    await act(async () => {});
    expect(mockStepProps.fields).toEqual(fields);
    expect(mockStepProps.step).toBe(2);
    expect(mockStepProps.consent).toBe(false);
    expect(mockStepProps.consentError).toBeNull();
  });
  it('keeps draft fields and transient proof ownership across the first booking', async () => {
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write: jest.fn(),
      },
      bankDetails: jest.fn().mockResolvedValue({ banks: [] }),
    } as unknown as OxygenClient;
    const props = {
      snapshot,
      client,
      busy: false,
      scopeKey: 'user/merchant/workflow',
      onExecute: jest.fn(),
    };
    const view = render(<OxygenApplicationFlow {...props} />);
    await act(async () => {});
    view.rerender(
      <OxygenApplicationFlow
        {...props}
        snapshot={{ ...snapshot, stage: 'booked', version: 2 }}
      />
    );
    await act(async () => {});
    expect(client.draft.read).toHaveBeenCalledTimes(1);
  });
});

describe('canonical server phone prerequisite', () => {
  it('renders phone OTP in eligibility_required before validation, but never after booking', async () => {
    const client = {
      draft: {
        read: jest.fn().mockResolvedValue({ version: 0, draft: null }),
        write: jest.fn(),
      },
      bankDetails: jest.fn(),
    } as unknown as OxygenClient;
    const pendingPhone = oxygenRuntimeSnapshotSchema.parse({
      ...snapshot,
      stage: 'eligibility_required',
      state: {
        applicationReference: '22222222-2222-4222-8222-222222222222',
        validated: false,
      },
    });
    const props = {
      snapshot: pendingPhone,
      client,
      busy: false,
      scopeKey: 'owned/workflow',
      onExecute: jest.fn(),
      phoneSentAt: new Date().toISOString(),
    };
    const view = render(<OxygenApplicationFlow {...props} />);
    await act(async () => {});
    expect(screen.getByLabelText('Six-digit verification code')).toBeTruthy();
    expect(client.draft.read).not.toHaveBeenCalled();
    view.rerender(
      <OxygenApplicationFlow
        {...props}
        snapshot={{ ...pendingPhone, stage: 'booked' }}
      />
    );
    await act(async () => {});
    expect(screen.queryByLabelText('Six-digit verification code')).toBeNull();
  });
});

it('reconfirms the saved account when reopening directly on Income, without submitting', async () => {
  const onExecute = jest.fn();
  const bankDetails = jest
    .fn()
    .mockImplementation(async ({ action }: { action: string }) =>
      action === 'banks'
        ? { banks: [{ code: '058', name: 'GT Bank' }] }
        : { accountName: 'TEST CUSTOMER' }
    );
  const client = {
    draft: {
      read: jest.fn().mockResolvedValue({
        version: 3,
        draft: {
          step: 2,
          fields: { bank_code: '058', account_number: '0123456789' },
        },
      }),
      write: jest.fn(),
    },
    bankDetails,
  } as unknown as OxygenClient;
  render(
    <OxygenApplicationFlow
      snapshot={snapshot}
      client={client}
      busy={false}
      scopeKey="restored/account"
      onExecute={onExecute}
    />
  );
  await act(async () => {});
  expect(bankDetails).toHaveBeenCalledWith({
    action: 'resolve',
    workflowId: snapshot.workflowId,
    bank_code: '058',
    account_number: '0123456789',
  });
  expect(mockStepProps.step).toBe(2);
  expect(mockStepProps.accountConfirmed).toBe(true);
  expect(onExecute).not.toHaveBeenCalled();
});

it('blocks leaving Identity for an incomplete BVN and highlights that field', async () => {
  const write = jest.fn();
  const client = {
    draft: {
      read: jest.fn().mockResolvedValue({
        version: 1,
        draft: {
          step: 0,
          fields: {
            first_name: 'Test',
            last_name: 'Customer',
            email: 'test@example.invalid',
            bvn: '1234567890',
            nin: '1234567890',
            date_of_birth: '1990-01-01',
          },
        },
      }),
      write,
    },
    bankDetails: jest.fn().mockResolvedValue({ banks: [] }),
  } as unknown as OxygenClient;
  const onExecute = jest.fn();
  render(
    <OxygenApplicationFlow
      snapshot={snapshot}
      client={client}
      busy={false}
      scopeKey="invalid/identity"
      onExecute={onExecute}
    />
  );
  await act(async () => {});
  act(() => mockStepProps.onStepChange(1));
  expect(mockStepProps.errors?.bvn).toBe('Enter your complete 11-digit BVN.');
  expect(mockStepProps.step).toBe(0);
  expect(write).not.toHaveBeenCalled();
  expect(onExecute).not.toHaveBeenCalled();
  act(() => mockStepProps.onChange({ bvn: '12345678901' }));
  expect(mockStepProps.errors?.bvn).toBeUndefined();
  expect(mockStepProps.errors?.nin).toBe('Enter your complete 11-digit NIN.');
  act(() => mockStepProps.onChange({ nin: '12345678901' }));
  expect(mockStepProps.errors).toEqual({});
  expect(mockStepProps.error).toBeNull();
  expect(write).not.toHaveBeenCalled();
  expect(onExecute).not.toHaveBeenCalled();
});
