import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { SettingsSectionRow } from './SettingsSectionRow';

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
    });
  });

  it('keeps trailing controls beside long setting copy', () => {
    render(
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
    });
    expect(screen.getByText('A setting with a long label')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Additional setting details that should wrap without moving the value'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('2.4.1')).toBeOnTheScreen();
  });
});
