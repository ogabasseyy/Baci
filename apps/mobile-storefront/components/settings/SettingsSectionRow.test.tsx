import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { SettingsSectionRow } from './SettingsSectionRow';

jest.mock('react-native', () => {
  const native = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return Object.defineProperty(Object.create(native), 'Pressable', {
    value: (props: import('react-native').PressableProps) => (
      <native.Pressable
        {...props}
        style={typeof props.style === 'function' ? undefined : props.style}
      />
    ),
  });
});

describe('SettingsSectionRow', () => {
  it('renders the row copy and triggers onPress', () => {
    const onPress = jest.fn();

    render(
      <SettingsSectionRow
        accessibilityLabel="Open privacy policy"
        accessibilityRole="link"
        icon="shield-outline"
        iconBackgroundColor="#E5E7EB"
        iconColor="#111827"
        label="Privacy Policy"
        labelColor="#111827"
        onPress={onPress}
        right={<Text>Open</Text>}
        subtitle="Review how your data is handled"
        subtitleColor="#6B7280"
      />
    );

    fireEvent.press(screen.getByRole('link', { name: 'Open privacy policy' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Privacy Policy')).toBeOnTheScreen();
    expect(
      screen.getByText('Review how your data is handled')
    ).toBeOnTheScreen();
  });

  it('applies the provided divider color when borderBottom is enabled', () => {
    render(
      <SettingsSectionRow
        accessibilityLabel="Open terms"
        accessibilityRole="link"
        borderBottom
        borderColor="#D1D5DB"
        icon="document-text-outline"
        iconBackgroundColor="#E5E7EB"
        iconColor="#111827"
        label="Terms of Service"
        labelColor="#111827"
        right={<Text>Open</Text>}
      />
    );

    expect(screen.getByRole('link', { name: 'Open terms' })).toHaveStyle({
      borderBottomColor: '#D1D5DB',
      borderBottomWidth: StyleSheet.hairlineWidth,
    });
  });

  it('keeps padded horizontal rows when NativeWind drops callback styles', () => {
    const { UNSAFE_getAllByType } = render(
      <View style={{ width: 180 }}>
        <SettingsSectionRow
          accessibilityLabel="Open account settings"
          accessibilityRole="button"
          icon="information-circle-outline"
          iconBackgroundColor="#E5E7EB"
          iconColor="#111827"
          label="A setting with a long label"
          labelColor="#111827"
          right={<Text>2.4.1</Text>}
          subtitle="Additional setting details that should wrap without moving the value"
          subtitleColor="#6B7280"
        />
      </View>
    );

    const row = screen.getByRole('button', { name: 'Open account settings' });
    expect(row).toHaveStyle({
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      flexWrap: 'nowrap',
    });
    expect(screen.getByText('A setting with a long label')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Additional setting details that should wrap without moving the value'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('2.4.1')).toBeOnTheScreen();
    const views = UNSAFE_getAllByType(View);
    expect(
      views.some((node) => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.width === 64 && style?.flexShrink === 0;
      })
    ).toBe(true);
    expect(
      views.some((node) => {
        const style = StyleSheet.flatten(node.props.style);
        return style?.minWidth === 0 && style?.flex === 1;
      })
    ).toBe(true);
  });

  it('keeps horizontal padding and divider while providing press feedback', () => {
    render(
      <SettingsSectionRow
        accessibilityLabel="Open terms"
        borderBottom
        borderColor="#D1D5DB"
        icon="document-text-outline"
        iconBackgroundColor="#E5E7EB"
        iconColor="#111827"
        label="Terms of Service"
        labelColor="#111827"
        onPress={jest.fn()}
        right={<Text>Open</Text>}
      />
    );

    const row = screen.getByRole('button', { name: 'Open terms' });
    fireEvent(row, 'pressIn');
    expect(row).toHaveStyle({
      opacity: 0.7,
      flexDirection: 'row',
      paddingHorizontal: 16,
      borderBottomColor: '#D1D5DB',
    });
    fireEvent(row, 'pressOut');
    expect(row).not.toHaveStyle({ opacity: 0.7 });
  });
});
