import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SavingsNotificationPreferences } from './SavingsNotificationPreferences';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const preferences = {
  encouragementEnabled: true,
  interestAlertsEnabled: true,
  quietHoursEnd: '08:00',
  quietHoursStart: '22:00',
  timeZone: 'Africa/Lagos',
  weeklySummaryEnabled: false,
};

describe('SavingsNotificationPreferences', () => {
  it('shows the editable 24-hour range in a 12-hour summary', () => {
    render(
      <SavingsNotificationPreferences
        isSaving={false}
        onUpdate={jest.fn<() => Promise<void>>()}
        preferences={preferences}
      />
    );

    expect(screen.getByLabelText('Quiet hours summary')).toHaveTextContent(
      '10:00 PM – 8:00 AM (use 24-hour HH:MM)'
    );
  });

  it('restores quiet-hour drafts when a preference update fails', async () => {
    const onUpdate = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('Unavailable'));
    render(
      <SavingsNotificationPreferences
        isSaving={false}
        onUpdate={onUpdate}
        preferences={preferences}
      />
    );

    const quietHoursStart = screen.getByLabelText('Quiet hours from');
    fireEvent.changeText(quietHoursStart, '23:30');
    await act(async () => {
      fireEvent(screen.getByLabelText('Quiet hours from'), 'endEditing');
      await Promise.resolve();
    });

    expect(onUpdate).toHaveBeenCalledWith({ quietHoursStart: '23:30' });
    expect(screen.getByLabelText('Quiet hours from').props.value).toBe('22:00');
  });

  it('disables controls while a preference update is in flight', () => {
    const onUpdate = jest.fn<() => Promise<void>>();
    render(
      <SavingsNotificationPreferences
        isSaving
        onUpdate={onUpdate}
        preferences={preferences}
      />
    );

    const weeklySummary = screen.getByRole('switch', {
      name: 'Weekly savings summary',
    });
    expect(weeklySummary).toBeDisabled();
    expect(screen.getByLabelText('Quiet hours from').props.editable).toBe(
      false
    );
    fireEvent(weeklySummary, 'valueChange', true);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
