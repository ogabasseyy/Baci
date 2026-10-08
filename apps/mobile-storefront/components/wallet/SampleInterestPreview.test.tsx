import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { hostedStorefrontRuntime } from '@/lib/hosted-storefront-runtime';
import { SampleInterestPreview } from './SampleInterestPreview';

jest.mock('@/lib/hosted-storefront-runtime', () => ({
  hostedStorefrontRuntime: {
    read: jest.fn(() => ({ environment: 'hosted-staging' })),
  },
}));

describe('SampleInterestPreview', () => {
  it('requires a button press, then closes and can be reopened', () => {
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue({} as never);
    render(
      <SampleInterestPreview
        colors={Colors.light}
        goal={{
          current_amount: 1250,
          status: 'active',
          title: 'Phone savings',
        }}
        ownerId="owner-a"
        presentation="tab"
      />
    );

    expect(
      screen.queryByText('Simulated preview—not a PiggyVest payout')
    ).toBeNull();
    const openPreview = screen.getByRole('button', {
      name: 'Preview sample interest',
    });
    expect(openPreview).toBeOnTheScreen();
    fireEvent.press(openPreview);
    expect(
      screen.getByText('Simulated preview—not a PiggyVest payout')
    ).toBeOnTheScreen();
    expect(screen.getByText('Savings before')).toBeOnTheScreen();
    expect(screen.getByText('₦1,250')).toBeOnTheScreen();
    expect(screen.getByText('Savings after sample')).toBeOnTheScreen();
    expect(screen.getByText('₦1,257.33')).toBeOnTheScreen();
    expect(screen.getByText('Gross sample interest')).toBeOnTheScreen();
    expect(screen.getByText('₦8.14')).toBeOnTheScreen();
    expect(screen.getByText('Sample tax')).toBeOnTheScreen();
    expect(screen.getByText('₦0.81')).toBeOnTheScreen();
    expect(
      screen.getByText('Net sample earnings (included above)')
    ).toBeOnTheScreen();
    expect(screen.getByText('₦7.33')).toBeOnTheScreen();
    expect(screen.getByText('Example interest notification')).toBeOnTheScreen();
    expect(screen.getByText(/No payout or push was sent/)).toBeOnTheScreen();

    const closePreview = screen.getByRole('button', {
      name: 'Close interest preview',
    });
    fireEvent.press(closePreview);
    expect(
      screen.queryByText('Simulated preview—not a PiggyVest payout')
    ).toBeNull();
    fireEvent.press(openPreview);
    expect(
      screen.getByText('Simulated preview—not a PiggyVest payout')
    ).toBeOnTheScreen();
  });

  it('shows a disabled control without a preview for a non-active goal', () => {
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue({} as never);
    render(
      <SampleInterestPreview
        colors={Colors.light}
        goal={{
          current_amount: 1250,
          status: 'paused',
          title: 'Paused savings',
        }}
        ownerId="owner-a"
        presentation="tab"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Sample preview unavailable' })
    ).toBeDisabled();
    expect(
      screen.queryByText('Simulated preview—not a PiggyVest payout')
    ).toBeNull();
  });

  it('renders safely with dark theme colors', () => {
    jest.mocked(hostedStorefrontRuntime.read).mockReturnValue({} as never);
    render(
      <SampleInterestPreview
        colors={Colors.dark}
        goal={{
          current_amount: 0,
          status: 'active',
          title: 'Emergency savings',
        }}
        ownerId="owner-b"
        presentation="tab"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Preview sample interest' })
    ).toBeOnTheScreen();
  });
});
