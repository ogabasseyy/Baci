import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import type { ReactNode } from 'react';
import { Alert } from 'react-native';
import FAQScreen from '@/app/faq';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';

jest.mock('expo-linking', () => ({
  openURL: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children?: ReactNode }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

describe('FAQScreen', () => {
  it('does not advertise retired CredPal in payment guidance', () => {
    render(<FAQScreen />);
    fireEvent.press(
      screen.getByRole('button', {
        name: /what payment methods do you accept/i,
      })
    );
    expect(screen.queryByText(/CredPal/i)).toBeNull();
    expect(screen.getByText(/Credit Direct/i)).toBeTruthy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens WhatsApp support with the configured message', () => {
    render(<FAQScreen />);

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Contact support using WhatsApp Support',
      })
    );

    expect(Linking.openURL).toHaveBeenCalledWith(
      `https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=Hi%2C%20I%20need%20help%20with%20my%20order`
    );
  });

  it('expands and collapses a selected FAQ answer', () => {
    render(<FAQScreen />);

    const question = screen.getByRole('button', {
      name: 'How do I track my order?',
    });
    fireEvent.press(question);

    expect(
      screen.getByText(/track your order by going to "Orders"/)
    ).toBeTruthy();

    fireEvent.press(question);

    expect(
      screen.queryByText(/track your order by going to "Orders"/)
    ).toBeNull();
  });

  it('opens telephone support through the device dialer', () => {
    render(<FAQScreen />);

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Contact support using Call Us',
      })
    );

    expect(Linking.openURL).toHaveBeenCalledWith('tel:+2348146978921');
  });

  it('reports when a support action cannot open its destination', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('failed'));

    render(<FAQScreen />);

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Contact support using Email Support',
      })
    );

    await waitFor(() => {
      expect(alert).toHaveBeenCalledWith(
        'Unable to Open',
        'Please try again later'
      );
    });
  });
});
