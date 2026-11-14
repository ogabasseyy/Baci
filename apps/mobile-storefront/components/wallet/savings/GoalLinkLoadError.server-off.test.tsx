import { fireEvent, render, screen } from '@testing-library/react-native';
import GoalLinkLoadError from './GoalLinkLoadError';

describe('GoalLinkLoadError', () => {
  it('explains the failure and retries on press', () => {
    const onRetry = jest.fn();
    render(<GoalLinkLoadError onRetry={onRetry} />);
    expect(screen.getByText("Couldn't open your savings")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
