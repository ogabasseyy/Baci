import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import { RepairBookingForm } from './RepairBookingForm';

const device = {
  id: 'd1',
  brand: 'Apple',
  model: 'iPhone 13',
  slug: 'apple-iphone-13',
  deviceType: 'Smartphone' as const,
  imageUrl: null,
  productId: null,
};

const quote = {
  id: 'q1',
  serviceTypeId: 'st1',
  serviceTypeName: 'Screen Replacement',
  price: 25000,
  isFromPrice: true,
  partQuality: null,
  turnaround: null,
  warrantyDays: null,
  description: null,
};

function fillValidForm() {
  fireEvent.changeText(screen.getByLabelText('Full name'), 'Ada Lovelace');
  fireEvent.changeText(screen.getByLabelText('Email'), 'ada@example.com');
  fireEvent.changeText(screen.getByLabelText('Phone number'), '08012345678');
  fireEvent.changeText(
    screen.getByLabelText('Describe the issue'),
    'The screen is cracked and needs replacing.'
  );
}

describe('RepairBookingForm', () => {
  const onSubmit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a device + quote summary when a quote is preselected', () => {
    render(
      <RepairBookingForm
        device={device}
        quote={quote}
        isSubmitting={false}
        serverError={null}
        fieldErrors={null}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('iPhone 13')).toBeTruthy();
    expect(screen.getByText(/Screen Replacement/)).toBeTruthy();
  });

  it('blocks submit and shows validation errors for an empty form', () => {
    render(
      <RepairBookingForm
        device={device}
        quote={quote}
        isSubmitting={false}
        serverError={null}
        fieldErrors={null}
        onSubmit={onSubmit}
      />
    );

    fireEvent.press(screen.getByLabelText('Submit repair request'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/valid email/i)).toBeTruthy();
  });

  it('submits a normalized payload with the linked device and quote ids', () => {
    render(
      <RepairBookingForm
        device={device}
        quote={quote}
        isSubmitting={false}
        serverError={null}
        fieldErrors={null}
        onSubmit={onSubmit}
      />
    );

    fillValidForm();
    fireEvent.press(screen.getByLabelText('Submit repair request'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Ada Lovelace',
        customerEmail: 'ada@example.com',
        customerPhone: '08012345678',
        deviceType: 'Smartphone',
        deviceModel: 'iPhone 13',
        issueDescription: 'The screen is cracked and needs replacing.',
        serviceType: 'dropoff',
        deviceId: 'd1',
        quoteId: 'q1',
      })
    );
  });

  it('hides courier pickup until a mobile payment flow exists', () => {
    render(
      <RepairBookingForm
        device={device}
        quote={quote}
        isSubmitting={false}
        serverError={null}
        fieldErrors={null}
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByLabelText('Pickup')).toBeNull();
    expect(
      screen.getByText(/Courier pickup will be available in a future update/i)
    ).toBeTruthy();

    fillValidForm();
    fireEvent.press(screen.getByLabelText('Submit repair request'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ serviceType: 'dropoff' })
    );
  });

  it('omits device/quote ids for the free-text path (no device)', () => {
    render(
      <RepairBookingForm
        device={null}
        quote={null}
        isSubmitting={false}
        serverError={null}
        fieldErrors={null}
        onSubmit={onSubmit}
      />
    );

    fireEvent.changeText(screen.getByLabelText('Device model'), 'Nokia 3310');
    fillValidForm();
    fireEvent.press(screen.getByLabelText('Submit repair request'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ deviceModel: 'Nokia 3310' })
    );
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.deviceId).toBeUndefined();
    expect(payload.quoteId).toBeUndefined();
  });

  it('renders a server error and disables the button while submitting', () => {
    render(
      <RepairBookingForm
        device={device}
        quote={quote}
        isSubmitting={true}
        serverError="Too many repair requests."
        fieldErrors={null}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('Too many repair requests.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Submit repair request'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
