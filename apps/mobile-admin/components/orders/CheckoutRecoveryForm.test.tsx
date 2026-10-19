import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  recovery: {
    draft: {
      address: 'Street',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: 'NG',
      phone: '08012345678',
      latitude: '6.5',
      longitude: '3.3',
    },
    busy: false,
    confirmed: false,
    error: null as string | null,
    preview: null as null | {
      previewId: string | null;
      canConfirm: boolean;
      error?: string;
      paidShippingFee: number;
      quote: {
        price: number;
        displayName: string;
        expiresAt: string;
        estimatedDays: number;
      };
    },
    update: vi.fn(),
    requestPreview: vi.fn(),
    confirm: vi.fn(),
  },
}));
vi.mock('@/hooks/orders/useCheckoutShippingRecovery', () => ({
  useCheckoutShippingRecovery: (...args: unknown[]) => {
    mocks.hook(...args);
    return mocks.recovery;
  },
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#555',
      primary: '#00f',
      border: '#ddd',
    },
  }),
}));
vi.mock('./CheckoutRecoveryAddressInput', async () => {
  const { checkoutRecoveryFormFixtures } = await import(
    './CheckoutRecoveryForm.test-support'
  );
  return {
    CheckoutRecoveryAddressInput: checkoutRecoveryFormFixtures.AddressInput,
  };
});

import { CheckoutRecoveryForm } from './CheckoutRecoveryForm';
import { checkoutRecoveryFormFixtures } from './CheckoutRecoveryForm.test-support';

const { order, preview } = checkoutRecoveryFormFixtures;
function renderForm() {
  const onBlockingChange = vi.fn();
  const onBusyChange = vi.fn();
  return {
    ...render(
      <CheckoutRecoveryForm
        order={order}
        onBlockingChange={onBlockingChange}
        onBusyChange={onBusyChange}
      />
    ),
    onBlockingChange,
    onBusyChange,
  };
}
function saveButton() {
  return screen.getByRole('button', {
    name: 'Save confirmed destination and quote',
  });
}

describe('CheckoutRecoveryForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recovery.busy = false;
    mocks.recovery.confirmed = false;
    mocks.recovery.error = null;
    mocks.recovery.preview = null;
  });
  it('renders all destination fields and starts with blank provenance fields without automatically requesting a quote', () => {
    const { onBlockingChange, onBusyChange } = renderForm();
    for (const label of ['Address', 'City', 'State', 'Phone'])
      expect(screen.getByText(label)).toBeTruthy();
    for (const field of [
      'address',
      'city',
      'state',
      'phone',
      'latitude',
      'longitude',
    ]) {
      expect(screen.getByLabelText(`Recovery ${field}`)).toBeTruthy();
    }
    expect(mocks.hook).toHaveBeenCalledWith('order', {
      address: 'Saved street',
      city: 'Ikeja',
      state: 'Lagos',
      phone: '08012345678',
      countryCode: '',
      latitude: '',
      longitude: '',
    });
    expect(mocks.recovery.requestPreview).not.toHaveBeenCalled();
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/A preview does not book or charge/)).toBeTruthy();
  });
  it('requests a quote only on preview and requires a separate explicit confirmation', () => {
    mocks.recovery.preview = preview();
    renderForm();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    );
    expect(mocks.recovery.requestPreview).toHaveBeenCalledOnce();
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(saveButton());
    expect(mocks.recovery.confirm).toHaveBeenCalledOnce();
  });
  it.each([
    'address',
    'city',
    'state',
  ])('clears country and pins and resets confirmation after editing %s', (field) => {
    mocks.recovery.preview = preview();
    renderForm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(`Recovery ${field}`), {
      target: { value: 'Updated destination' },
    });
    expect(mocks.recovery.update).toHaveBeenCalledWith({
      [field]: 'Updated destination',
      countryCode: '',
      latitude: '',
      longitude: '',
    });
    fireEvent.click(saveButton());
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
  });
  it.each([
    'phone',
    'latitude',
    'longitude',
  ])('updates %s without silently changing other destination fields', (field) => {
    renderForm();
    fireEvent.change(screen.getByLabelText(`Recovery ${field}`), {
      target: { value: '123' },
    });
    expect(mocks.recovery.update).toHaveBeenCalledWith({ [field]: '123' });
  });
  it('clears pending provenance after search edits and accepts only an explicitly selected new pin', () => {
    mocks.recovery.preview = preview();
    renderForm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Destination search'), {
      target: { value: 'New search' },
    });
    expect(mocks.recovery.update).toHaveBeenCalledWith({
      address: 'New search',
      city: '',
      state: '',
      countryCode: '',
      latitude: '',
      longitude: '',
    });
    fireEvent.click(saveButton());
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Select destination pin' })
    );
    expect(mocks.recovery.update).toHaveBeenLastCalledWith({
      address: 'Selected destination',
      city: 'Ikeja',
      state: 'Lagos',
      countryCode: 'NG',
      latitude: '6.6',
      longitude: '3.4',
    });
  });
  it('resets checkbox confirmation when preview is requested again', () => {
    mocks.recovery.preview = preview();
    renderForm();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    );
    fireEvent.click(saveButton());
    expect(mocks.recovery.requestPreview).toHaveBeenCalledOnce();
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
  });
  it('displays paid fee, quote fee, estimated delivery and local expiry', () => {
    mocks.recovery.preview = preview();
    renderForm();
    expect(screen.getByText('Paid shipping: ₦100')).toBeTruthy();
    expect(screen.getByText('New quote: ₦100 · GIG Logistics')).toBeTruthy();
    expect(screen.getByText('Estimated delivery: 2 days')).toBeTruthy();
    expect(
      screen.getByText(
        `Expires: ${new Date(preview().quote.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
      )
    ).toBeTruthy();
  });
  it('shows an unconfirmable preview explanation without offering save or a payment action', () => {
    mocks.recovery.preview = {
      ...preview(),
      canConfirm: false,
      previewId: null,
      error: 'The rate has changed. Contact support.',
    };
    renderForm();
    expect(screen.getByRole('alert').textContent).toContain(
      'The rate has changed. Contact support.'
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Save confirmed destination and quote',
      })
    ).toBeNull();
    expect(screen.queryByText(/Fund wallet|Pay difference/)).toBeNull();
  });
  it('shows the fail-closed fallback when an unconfirmable preview has no explanation', () => {
    mocks.recovery.preview = {
      ...preview(),
      canConfirm: false,
      previewId: null,
    };
    renderForm();
    expect(screen.getByRole('alert').textContent).toContain(
      'It cannot be confirmed here. Contact support to review this order.'
    );
  });
  it('displays a preview request error and keeps booking blocked', () => {
    mocks.recovery.error = 'Could not load the quote. Try again.';
    const { onBlockingChange } = renderForm();
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load the quote. Try again.'
    );
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('disables edits, preview and confirmation while busy and notifies its parent', () => {
    mocks.recovery.busy = true;
    mocks.recovery.preview = preview();
    const { onBusyChange, onBlockingChange, unmount } = renderForm();
    expect(
      (screen.getByLabelText('Recovery address') as HTMLInputElement).readOnly
    ).toBe(true);
    expect(
      (screen.getByLabelText('Destination search') as HTMLInputElement).disabled
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Recovery city'), {
      target: { value: 'Another city' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Please wait…' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(saveButton());
    expect(mocks.recovery.update).not.toHaveBeenCalled();
    expect(mocks.recovery.requestPreview).not.toHaveBeenCalled();
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });
  it('unblocks after confirmation and reminds the operator to book separately', () => {
    mocks.recovery.confirmed = true;
    const { onBlockingChange, onBusyChange, unmount } = renderForm();
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.getByText(/Use Book with GIG Logistics separately/)
    ).toBeTruthy();
    expect(mocks.recovery.confirm).not.toHaveBeenCalled();
    unmount();
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
