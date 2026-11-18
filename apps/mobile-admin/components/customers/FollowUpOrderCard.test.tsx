import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
