import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { ProfileQuizBadge } from './ProfileQuizBadge';

describe('ProfileQuizBadge', () => {
  it('shows the badge label and event title', () => {
    render(
      <ProfileQuizBadge eventTitle="Today Quiz" label="SuperQuiz badge" />
    );

    expect(screen.getByText('SuperQuiz badge')).toBeTruthy();
    expect(screen.getByText('Today Quiz')).toBeTruthy();
  });
});
