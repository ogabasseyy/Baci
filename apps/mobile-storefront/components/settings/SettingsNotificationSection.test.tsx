import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActivityIndicator, Switch } from 'react-native';
import Colors from '@/constants/Colors';
import { SettingsNotificationSection } from './SettingsNotificationSection';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeInDown: {
      delay: () => ({
        duration: () => ({}),
      }),
    },
  };
});

describe('SettingsNotificationSection', () => {
  it('renders a theme-colored notification toggle and reports changes', () => {
    const onToggle = jest.fn();

    const { UNSAFE_getByType } = render(
      <SettingsNotificationSection
        colors={Colors.dark}
        isLoading={false}
        isRegistered
        onToggle={onToggle}
      />
    );

    const toggle = UNSAFE_getByType(Switch);

    expect(toggle.props.trackColor).toEqual({
      false: Colors.dark.border,
      true: Colors.dark.primary,
    });
    expect(
      screen.getByLabelText('Toggle push notifications')
    ).toBeOnTheScreen();

    fireEvent(toggle, 'valueChange', false);

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('shows a theme-colored loader while push state is loading', () => {
    const { UNSAFE_getByType } = render(
      <SettingsNotificationSection
        colors={Colors.dark}
        isLoading
        isRegistered={false}
        onToggle={jest.fn()}
      />
    );

    expect(UNSAFE_getByType(ActivityIndicator).props.color).toBe(
      Colors.dark.primary
    );
    expect(screen.queryByLabelText('Toggle push notifications')).toBeNull();
  });

  it('shows an accessible inline registration error without hiding the toggle', () => {
    render(
      <SettingsNotificationSection
        colors={Colors.dark}
        error="Allow notifications in Settings, then try again."
        isLoading={false}
        isRegistered={false}
        onToggle={jest.fn()}
      />
    );

    expect(
      screen.getByRole('alert', {
        name: 'Allow notifications in Settings, then try again.',
      })
    ).toHaveTextContent('Allow notifications in Settings, then try again.');
    expect(screen.getByRole('alert')).toHaveProp(
      'accessibilityLabel',
      'Allow notifications in Settings, then try again.'
    );
    expect(screen.getByRole('alert')).toHaveStyle({
      color: Colors.dark.error,
      paddingHorizontal: 16,
    });
    expect(screen.getByLabelText('Toggle push notifications')).toHaveProp(
      'value',
      false
    );
  });
});
