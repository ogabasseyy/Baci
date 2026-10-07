import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsScheduleFields } from './SavingsScheduleFields';
import type { StartSavingsController } from './start-savings-controller.types';

function createController(): StartSavingsController {
  return {
    frequency: 'daily',
    preferredDebitTime: '06:20',
    setFrequency: jest.fn(),
    setPreferredDebitTime: jest.fn(),
    setStartDate: jest.fn(),
    startDate: '2026-09-22',
  } as unknown as StartSavingsController;
}

describe('SavingsScheduleFields', () => {
  it('displays savings schedule values in user-facing formats', () => {
    render(
      <SavingsScheduleFields
        colors={Colors.light}
        controller={createController()}
      />
    );

    expect(screen.getByText('6:20 AM')).toBeOnTheScreen();
    expect(screen.getByText('22 September 2026')).toBeOnTheScreen();
  });
});
