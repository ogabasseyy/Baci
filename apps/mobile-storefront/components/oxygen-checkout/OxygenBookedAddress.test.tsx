import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenClientError } from '@/services/oxygen/errors';
import { OxygenBookedAddress } from './OxygenBookedAddress';

jest.mock('./OxygenHomeAddress', () => ({ OxygenHomeAddress: () => null }));
jest.mock('./OxygenAddressProof', () => ({
  OxygenAddressProof: ({ onPick }: { onPick: (source: string) => void }) => {
    const { Text } = require('react-native');
    return <Text onPress={() => onPick('photos')}>Choose photo</Text>;
  },
}));
jest.mock('./use-oxygen-proof', () => ({
  useOxygenProof: () => ({ proof: null, pick: jest.fn(), error: null }),
}));
jest.mock('./OxygenAddressReview', () => ({
  OxygenAddressReview: ({ status }: { status: string }) => {
    const { Text } = require('react-native');
    return <Text>proof-{status}</Text>;
  },
}));
jest.mock('./OxygenFormPrimitives', () => ({
  useOxygenColors: () => ({ text: '#111' }),
  OxygenButton: ({
    title,
    onPress,
    disabled,
  }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
  }) => {
    const { Text } = require('react-native');
    return (
      <Text disabled={disabled} onPress={disabled ? undefined : onPress}>
        {title}
      </Text>
    );
  },
}));
it('retains selected proof and retry UI when a handled submission error makes no canonical transition', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking', kyc: { address_status: 'NOT_DONE' } },
  } as OxygenRuntimeSnapshot;
  const draft = {
    fields: {
      home_state: 'Lagos',
      home_lga: 'Ikeja',
      home_city: 'Ikeja',
      home_street: 'Allen',
      home_landmark: 'Gate',
      home_house_number: '1',
    },
  };
  const client = {
    draft: { read: jest.fn().mockResolvedValue({ draft }) },
  } as unknown as OxygenClient;
  const execute = jest.fn().mockResolvedValue(undefined);
  const proof = {
    bytes: new Uint8Array([1, 2, 3]),
    type: 'image/png',
    name: 'proof.png',
  };
  render(
    <OxygenBookedAddress
      snapshot={snapshot}
      client={client}
      proof={proof}
      busy={false}
      onExecute={execute}
      onRefresh={jest.fn()}
    />
  );
  expect(await screen.findByText('1 Allen')).toBeTruthy();
  const submit = await screen.findByText('Submit saved home address and proof');
  await act(async () => {
    fireEvent.press(submit);
  });
  expect(execute).toHaveBeenCalledWith(
    {
      action: 'submit_address',
      state: 'Lagos',
      lga: 'Ikeja',
      city: 'Ikeja',
      street: 'Allen',
      landmark: 'Gate',
      house_number: '1',
    },
    proof
  );
  expect(screen.getByText('proof-ready')).toBeTruthy();
  expect(screen.queryByText('proof-reviewing')).toBeNull();
  expect(screen.getByText('Submit saved home address and proof')).toBeTruthy();
});
it('recovers a retired draft using the saved residential context', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking', kyc: { address_status: 'NOT_DONE' } },
  } as OxygenRuntimeSnapshot;
  const client = {
    draft: {
      read: jest.fn().mockRejectedValue(new OxygenClientError('http', 409)),
    },
    residentialContext: jest.fn().mockResolvedValue({
      source: 'saved',
      address: {
        state: 'Lagos',
        lga: 'Ikeja',
        city: 'Ikeja',
        street: 'Allen',
        landmark: 'Gate',
        house_number: '1',
      },
    }),
  } as unknown as OxygenClient;
  const execute = jest.fn().mockResolvedValue(undefined);
  render(
    <OxygenBookedAddress
      snapshot={snapshot}
      client={client}
      proof={{
        bytes: new Uint8Array([1]),
        type: 'image/png',
        name: 'proof.png',
      }}
      busy={false}
      onExecute={execute}
      onRefresh={jest.fn()}
    />
  );
  fireEvent.press(
    await screen.findByText('Submit saved home address and proof')
  );
  expect(client.residentialContext).toHaveBeenCalledWith('workflow');
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'submit_address',
      street: 'Allen',
      lga: 'Ikeja',
    }),
    expect.anything()
  );
});
it('requires the customer to confirm a checkout address before submitting it as home', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking', kyc: { address_status: 'NOT_DONE' } },
  } as OxygenRuntimeSnapshot;
  const client = {
    draft: {
      read: jest.fn().mockRejectedValue(new OxygenClientError('http', 409)),
    },
    residentialContext: jest.fn().mockResolvedValue({
      source: 'checkout',
      address: {
        state: 'Lagos',
        lga: 'Ikeja',
        city: 'Ikeja',
        street: 'Allen',
        landmark: 'Gate',
        house_number: '1',
      },
    }),
  } as unknown as OxygenClient;
  const execute = jest.fn().mockResolvedValue(undefined);
  render(
    <OxygenBookedAddress
      snapshot={snapshot}
      client={client}
      proof={{
        bytes: new Uint8Array([1]),
        type: 'image/png',
        name: 'proof.png',
      }}
      busy={false}
      onExecute={execute}
      onRefresh={jest.fn()}
    />
  );
  const submit = await screen.findByText('Submit saved home address and proof');
  fireEvent.press(submit);
  expect(execute).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(submit);
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each([
  false,
  true,
])('retries a failed address lookup without resubmitting the address (retired draft: %s)', async (retiredDraft) => {
  const snapshot = {
    workflowId: 'workflow',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking' },
  } as OxygenRuntimeSnapshot;
  const read = jest
    .fn()
    .mockRejectedValueOnce(
      retiredDraft
        ? new OxygenClientError('http', 409)
        : new OxygenClientError('transport')
    )
    .mockResolvedValue({ draft: null });
  const residentialContext = jest
    .fn()
    .mockRejectedValue(new OxygenClientError('transport'));
  const client = {
    draft: { read },
    residentialContext,
  } as unknown as OxygenClient;
  const execute = jest.fn();
  render(
    <OxygenBookedAddress
      snapshot={snapshot}
      client={client}
      busy={false}
      onExecute={execute}
      onRefresh={jest.fn()}
    />
  );
  await screen.findByRole('alert');
  fireEvent.press(screen.getByText('Retry address lookup'));
  expect(await screen.findByText('Choose photo')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
  expect(residentialContext).toHaveBeenCalledTimes(retiredDraft ? 1 : 0);
  expect(execute).not.toHaveBeenCalled();
});

it('submits saved address with proof when optional landmark is blank', async () => {
  const snapshot = {
    workflowId: 'workflow',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking', kyc: { address_status: 'NOT_DONE' } },
  } as OxygenRuntimeSnapshot;
  const client = {
    draft: {
      read: jest.fn().mockResolvedValue({
        draft: {
          fields: {
            home_state: 'Lagos',
            home_lga: 'Ikeja',
            home_city: 'Ikeja',
            home_street: 'Allen',
            home_house_number: '1',
          },
        },
      }),
    },
  } as unknown as OxygenClient;
  const execute = jest.fn().mockResolvedValue(undefined);
  const proof = {
    bytes: new Uint8Array([1, 2, 3]),
    type: 'image/png',
    name: 'proof.png',
  };
  render(
    <OxygenBookedAddress
      snapshot={snapshot}
      client={client}
      proof={proof}
      busy={false}
      onExecute={execute}
      onRefresh={jest.fn()}
    />
  );
  const submit = await screen.findByText('Submit saved home address and proof');
  await act(async () => {
    fireEvent.press(submit);
  });
  expect(execute).toHaveBeenCalledWith(
    {
      action: 'submit_address',
      state: 'Lagos',
      lga: 'Ikeja',
      city: 'Ikeja',
      street: 'Allen',
      landmark: '',
      house_number: '1',
    },
    proof
  );
});
