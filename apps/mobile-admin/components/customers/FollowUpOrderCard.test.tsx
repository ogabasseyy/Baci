import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as Linking from 'expo-linking';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { oxygenProcessingOrder } from '@/test/fixtures/oxygen-follow-up';
import { FollowUpOrderCard } from './FollowUpOrderCard';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {}, shadows: {} }),
}));

describe('FollowUpOrderCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['paid', 'Staff follow-up · Paid'],
    ['refunded', 'Staff follow-up · Refunded'],
    ['cancelled', 'Staff follow-up · Cancelled'],
    ['pending', 'Staff follow-up'],
  ] as const)('shows a retained order with payment status %s', (status, label) => {
    render(
      <FollowUpOrderCard
        item={{
          ...oxygenProcessingOrder,
          oxygen_follow_up_status: undefined,
          payment_status: status,
          staff_follow_up_only: true,
        }}
        displayTotal="₦10k"
        initials="A"
      />
    );

    expect(screen.getByText(`₦10k • ${label}`)).toBeInTheDocument();
  });

  it('opens the Oxygen order and omits an empty email action', () => {
    render(
      <FollowUpOrderCard
        item={{ ...oxygenProcessingOrder, customer_email: '' }}
        displayTotal="₦10k"
        initials="A"
      />
    );

    expect(screen.queryByRole('button', { name: 'Email Ada' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /Oxygen · Processing/ })
    );
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/(admin)/order/[id]',
      params: { id: oxygenProcessingOrder.id },
    });
  });

  it('shows the recorded provider on standard follow-up rows', () => {
    render(
      <FollowUpOrderCard
        item={{
          ...oxygenProcessingOrder,
          oxygen_follow_up_status: undefined,
          payment_method: 'paystack',
          payment_status: 'unpaid',
        }}
        displayTotal="₦10k"
        initials="A"
      />
    );

    expect(
      screen.getByText('₦10k • Paystack · Checkout Drop-off')
    ).toBeVisible();
  });

  it.each([
    '+---',
    '+1',
    '123',
    '1234',
    '+1234567890123456',
    '   ',
    '',
  ])('hides phone actions for unusable phone values: %s', (phone) => {
    render(
      <FollowUpOrderCard
        item={{ ...oxygenProcessingOrder, customer_phone: phone }}
        displayTotal="₦10k"
        initials="A"
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Message Ada on WhatsApp' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Call Ada' })).toBeNull();
  });

  it('opens formatted phone contacts with digits and preserves the international prefix for calls', () => {
    render(
      <FollowUpOrderCard
        item={{
          ...oxygenProcessingOrder,
          customer_phone: ' +234 (803) 123-4567 ',
        }}
        displayTotal="₦10k"
        initials="A"
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Message Ada on WhatsApp' })
    );
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenNthCalledWith(
      1,
      'https://wa.me/2348031234567'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Call Ada' }));
    expect(Linking.openURL).toHaveBeenCalledTimes(2);
    expect(Linking.openURL).toHaveBeenNthCalledWith(2, 'tel:+2348031234567');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each([
    '+882169876543210',
    '00882169876543210',
  ])('opens equivalent international prefixes for %s', (phone) => {
    render(
      <FollowUpOrderCard
        item={{ ...oxygenProcessingOrder, customer_phone: phone }}
        displayTotal="₦10k"
        initials="A"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Message Ada on WhatsApp' })
    );
    expect(Linking.openURL).toHaveBeenNthCalledWith(
      1,
      'https://wa.me/882169876543210'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Call Ada' }));
    expect(Linking.openURL).toHaveBeenNthCalledWith(2, 'tel:+882169876543210');
  });

  it.each([
    '0803 123 4567',
    '803 123 4567',
    '2348031234567',
  ])('keeps national or unqualified calls without assuming a WhatsApp country code: %s', (phone) => {
    render(
      <FollowUpOrderCard
        item={{ ...oxygenProcessingOrder, customer_phone: phone }}
        displayTotal="₦10k"
        initials="A"
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Message Ada on WhatsApp' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Call Ada' }));
    expect(Linking.openURL).toHaveBeenCalledExactlyOnceWith(
      `tel:${phone.replace(/\D/g, '')}`
    );
  });

  it('encodes recipient delimiters instead of creating email headers', () => {
    render(
      <FollowUpOrderCard
        item={{
          ...oxygenProcessingOrder,
          customer_email: 'buyer?bcc=other%40example.com&x=x@valid.com',
        }}
        displayTotal="₦10k"
        initials="A"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Email Ada' }));
    expect(Linking.openURL).toHaveBeenCalledExactlyOnceWith(
      'mailto:buyer%3Fbcc%3Dother%2540example.com%26x%3Dx@valid.com'
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('hides the email action for malformed recipient text', () => {
    render(
      <FollowUpOrderCard
        item={{ ...oxygenProcessingOrder, customer_email: 'not-an-email' }}
        displayTotal="₦10k"
        initials="A"
      />
    );
    expect(screen.queryByRole('button', { name: 'Email Ada' })).toBeNull();
  });

  it('opens the customer for ordinary follow-ups linked to a customer', () => {
    render(
      <FollowUpOrderCard
        item={{
          ...oxygenProcessingOrder,
          oxygen_follow_up_status: undefined,
          payment_method: 'card',
        }}
        displayTotal="₦10k"
        initials="A"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Follow up: Ada/ }));
    expect(mocks.push).toHaveBeenCalledWith({
      pathname: '/(admin)/customer/[id]',
      params: { id: oxygenProcessingOrder.customer_id },
    });
  });
});
