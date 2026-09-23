import { render, screen } from '@testing-library/react-native';
import { QuizPlayerAvatar } from './QuizPlayerAvatar';

describe('QuizPlayerAvatar', () => {
  it('renders a stable expressive avatar with an accessible name', () => {
    const { rerender } = render(
      <QuizPlayerAvatar
        accentColor="#ff9900"
        displayName="Bassey"
        surfaceColor="#331f00"
      />
    );
    const firstAvatar = screen.getByLabelText('Avatar for Bassey');
    const firstEmoji = firstAvatar.props.children.props.children;

    rerender(
      <QuizPlayerAvatar
        accentColor="#ff9900"
        displayName="Bassey"
        surfaceColor="#331f00"
      />
    );

    expect(screen.getByLabelText('Avatar for Bassey')).toBeTruthy();
    expect(
      screen.getByLabelText('Avatar for Bassey').props.children.props.children
    ).toBe(firstEmoji);
  });
});
