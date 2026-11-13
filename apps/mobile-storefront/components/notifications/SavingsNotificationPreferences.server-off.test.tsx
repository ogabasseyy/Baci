import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SavingsNotificationPreferences } from './SavingsNotificationPreferences';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

// Preferences are only shown once the server returned them; with PiggyVest
// off they still render plainly, without technical format hints.
describe('savings notification preferences with the server off', () => {
  it('shows a plain quiet-hours summary and a separate 24-hour hint', () => {
    render(
      <SavingsNotificationPreferences
        isSaving={false}
        onUpdate={jest.fn<() => Promise<void>>()}
        preferences={{
          encouragementEnabled: true,
          interestAlertsEnabled: true,
          quietHoursEnd: '08:00',
          quietHoursStart: '22:00',
          timeZone: 'Africa/Lagos',
          weeklySummaryEnabled: false,
        }}
      />
    );
    expect(screen.getByLabelText('Quiet hours summary')).toHaveTextContent(
      '22:00 – 08:00'
    );
    expect(screen.queryByText(/HH:MM/)).toBeNull();
    expect(
      screen.getByText('Enter times in 24-hour format, for example 22:00.')
    ).toBeTruthy();
  });

  it('keeps the summary in step with the fields while they are edited', () => {
    render(
      <SavingsNotificationPreferences
        isSaving={false}
        onUpdate={jest.fn<() => Promise<void>>()}
        preferences={{
          encouragementEnabled: true,
          interestAlertsEnabled: true,
          quietHoursEnd: '08:00',
          quietHoursStart: '22:00',
          timeZone: 'Africa/Lagos',
          weeklySummaryEnabled: false,
        }}
      />
    );
    fireEvent.changeText(screen.getByLabelText('Quiet hours from'), '21:30');
    expect(screen.getByLabelText('Quiet hours summary')).toHaveTextContent(
      '21:30 – 08:00'
    );
  });
});
