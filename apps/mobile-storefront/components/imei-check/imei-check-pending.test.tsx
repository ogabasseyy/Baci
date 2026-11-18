import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiCheckPending } from './imei-check-pending';

describe('ImeiCheckPending', () => {
  it('announces active async processing', () => {
    render(<ImeiCheckPending colors={Colors.light} paused={false} canResume />);

    expect(screen.getByText(/usually under a minute/i)).toBeTruthy();
  });

  it('explains that processing continues after foreground polling stops', () => {
    render(<ImeiCheckPending colors={Colors.light} paused canResume />);

    expect(screen.getByText(/check back later/i)).toBeTruthy();
  });

  it('asks to keep the screen open when saving is not confirmed, like web', () => {
    render(<ImeiCheckPending colors={Colors.light} paused={false} />);

    expect(screen.getByText(/keep this screen open/i)).toBeTruthy();
  });
});
