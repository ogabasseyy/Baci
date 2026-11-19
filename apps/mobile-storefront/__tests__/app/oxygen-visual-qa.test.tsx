import { render, screen } from '@testing-library/react-native';
import { OxygenVisualQaFixture } from '@/components/oxygen-preview/visual-qa-route';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));
jest.mock('@/components/oxygen-preview/entry', () => ({
  OxygenPreview: ({ initial }: { initial: string }) => {
    const { Text } = require('react-native');
    return <Text>Fixture {initial}</Text>;
  },
  previewSteps: ['identity', 'bank'],
}));

it('opens the default fixture when no step is specified', () => {
  render(<OxygenVisualQaFixture />);
  expect(screen.getByText('Fixture identity')).toBeTruthy();
});

it.each(['unknown', ['bank']])('rejects an invalid fixture step %j', (step) => {
  render(<OxygenVisualQaFixture step={step} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Unknown Oxygen preview step.'
  );
  expect(screen.queryByText('Fixture identity')).toBeNull();
});
