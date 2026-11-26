import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { OxygenClient } from '@/services/oxygen/client';
import { OxygenBookedAddress } from './OxygenBookedAddress';
import { OxygenProofPickerContext } from './use-oxygen-proof';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/components/ui/AddressAutocomplete', () => ({
  AddressAutocomplete: () => null,
}));

it('retains the uploaded utility bill when editing home address fields at booked stage', async () => {
  const snapshot = {
    workflowId: '11111111-1111-4111-8111-111111111111',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking', kyc: { address_status: 'NOT_DONE' } },
  } as OxygenRuntimeSnapshot;
  const client = {
    draft: {
      read: jest.fn().mockResolvedValue({
        draft: {
          step: 2,
          fields: {
            home_state: 'Lagos',
            home_lga: 'Ikeja',
            home_city: 'Ikeja',
            home_street: 'Allen Avenue',
            home_house_number: '10',
          },
        },
      }),
    },
  } as unknown as OxygenClient;
  const picker = {
    pick: jest.fn().mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///bill.pdf',
          name: 'bill.pdf',
          mimeType: 'application/pdf',
          size: 5,
        },
      ],
    }),
    size: () => 5,
    readBytes: async () => new Uint8Array([37, 80, 68, 70, 45]),
  };
  const onExecute = jest.fn().mockResolvedValue(undefined);
  render(
    <OxygenProofPickerContext value={picker}>
      <OxygenBookedAddress
        snapshot={snapshot}
        client={client}
        busy={false}
        onExecute={onExecute}
        onRefresh={jest.fn()}
      />
    </OxygenProofPickerContext>
  );
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Choose file' }));
  });
  expect(
    await screen.findByRole('button', {
      name: 'Submit saved home address and proof',
    })
  ).toBeEnabled();
  fireEvent.press(screen.getByRole('button', { name: 'Edit home address' }));
  fireEvent.changeText(
    screen.getByLabelText('Nearby landmark'),
    'Near Allen Roundabout'
  );
  const submit = screen.getByRole('button', {
    name: 'Submit saved home address and proof',
  });
  expect(submit).toBeEnabled();
  await act(async () => {
    fireEvent.press(submit);
  });
  expect(onExecute).toHaveBeenCalledWith(
    {
      action: 'submit_address',
      state: 'Lagos',
      lga: 'Ikeja',
      city: 'Ikeja',
      street: 'Allen Avenue',
      house_number: '10',
      landmark: 'Near Allen Roundabout',
    },
    expect.objectContaining({ name: 'bill.pdf', type: 'application/pdf' })
  );
});

it('clears the selected utility bill when a material address field changes at booked stage', async () => {
  const snapshot = {
    workflowId: '11111111-1111-4111-8111-111111111111',
    version: 1,
    stage: 'booked',
    executionEnabled: true,
    state: { bookingReference: 'booking', kyc: { address_status: 'NOT_DONE' } },
  } as OxygenRuntimeSnapshot;
  const client = {
    draft: {
      read: jest.fn().mockResolvedValue({
        draft: {
          step: 2,
          fields: {
            home_state: 'Lagos',
            home_lga: 'Ikeja',
            home_city: 'Ikeja',
            home_street: 'Allen Avenue',
            home_house_number: '10',
          },
        },
      }),
    },
  } as unknown as OxygenClient;
  const picker = {
    pick: jest.fn().mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///bill.pdf',
          name: 'bill.pdf',
          mimeType: 'application/pdf',
          size: 5,
        },
      ],
    }),
    size: () => 5,
    readBytes: async () => new Uint8Array([37, 80, 68, 70, 45]),
  };
  render(
    <OxygenProofPickerContext value={picker}>
      <OxygenBookedAddress
        snapshot={snapshot}
        client={client}
        busy={false}
        onExecute={jest.fn()}
        onRefresh={jest.fn()}
      />
    </OxygenProofPickerContext>
  );
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Choose file' }));
  });
  expect(
    await screen.findByRole('button', {
      name: 'Submit saved home address and proof',
    })
  ).toBeEnabled();
  fireEvent.press(screen.getByRole('button', { name: 'Edit home address' }));
  fireEvent.press(screen.getByRole('button', { name: 'Change address' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Enter address manually' })
  );
  fireEvent.changeText(screen.getByLabelText('Street address'), 'Opebi Road');
  expect(
    screen.queryByRole('button', {
      name: 'Submit saved home address and proof',
    })
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
});
