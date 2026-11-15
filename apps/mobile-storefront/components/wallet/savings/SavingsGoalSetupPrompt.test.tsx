import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsGoalSetupPrompt } from './SavingsGoalSetupPrompt';

const onChoose = jest.fn();
const onSubmit = jest.fn();
const renderPrompt = (
  props: Partial<React.ComponentProps<typeof SavingsGoalSetupPrompt>> = {}
) =>
  render(
    <SavingsGoalSetupPrompt
      colors={Colors.light}
      choice={null}
      statusReady
      submitting={false}
      error={null}
      onChoose={onChoose}
      onSubmit={onSubmit}
      {...props}
    />
  );

beforeEach(() => jest.clearAllMocks());

describe('SavingsGoalSetupPrompt', () => {
  it('disables setup until the status read has finished, even with a choice', () => {
    renderPrompt({ choice: true, statusReady: false });
    const button = screen.getByRole('button', { name: 'Finish setting up' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables setup without a choice and enables it with one', () => {
    const view = renderPrompt();
    expect(
      screen.getByRole('button', { name: 'Finish setting up' })
    ).toBeDisabled();
    view.unmount();
    renderPrompt({ choice: false });
    const button = screen.getByRole('button', { name: 'Finish setting up' });
    expect(button).not.toBeDisabled();
    fireEvent.press(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('marks only the chosen answer and reports both explicit answers', () => {
    renderPrompt({ choice: false });
    expect(
      screen.getByRole('radio', { name: 'No, do not earn interest' })
    ).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true })
    );
    expect(
      screen.getByRole('radio', { name: 'Yes, earn interest' })
    ).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: false })
    );
    fireEvent.press(screen.getByRole('radio', { name: 'Yes, earn interest' }));
    expect(onChoose).toHaveBeenCalledWith(true);
  });

  it('locks the controls while submitting', () => {
    renderPrompt({ choice: true, submitting: true });
    expect(screen.getByText('Setting up…')).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Yes, earn interest' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Finish setting up' })
    ).toBeDisabled();
  });

  it('shows an error message when given one', () => {
    renderPrompt({ error: 'Something safe' });
    expect(screen.getByText('Something safe')).toBeTruthy();
  });
});
