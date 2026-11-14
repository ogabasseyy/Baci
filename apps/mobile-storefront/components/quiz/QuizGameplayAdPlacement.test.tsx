import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { createQuizGameplayAdFooterStyles } from './QuizGameplayAdFooter.styles';
import { QuizGameplayAdPlacement } from './QuizGameplayAdPlacement';

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    LARGE_ANCHORED_ADAPTIVE_BANNER: 'large-anchored-adaptive-banner',
    MEDIUM_RECTANGLE: 'medium-rectangle',
  },
}));
jest.mock('@/services/quiz-ad-analytics', () => ({
  trackQuizAdEvent: jest.fn(),
}));

describe('QuizGameplayAdPlacement', () => {
  it('renders the native banner inside the sponsored slot', () => {
    const styles = createQuizGameplayAdFooterStyles({
      background: '#000000',
      border: '#222222',
      textSecondary: '#aaaaaa',
    });

    render(
      <QuizGameplayAdPlacement
        bannerUnitId="ca-app-pub-3940256099942544/9214589741"
        styles={styles}
      />
    );

    expect(screen.getByText('Sponsored')).toBeTruthy();
    expect(screen.getByTestId('quiz-banner-slot')).toBeTruthy();
  });

  it('uses the large rectangle for the ad inside the finished screen', () => {
    const styles = createQuizGameplayAdFooterStyles({
      background: '#000000',
      border: '#222222',
      textSecondary: '#aaaaaa',
    });

    const view = render(
      <QuizGameplayAdPlacement
        bannerUnitId="ca-app-pub-3940256099942544/9214589741"
        layout="inline"
        styles={styles}
      />
    );

    expect(screen.getByTestId('quiz-results-ad')).toBeTruthy();
    expect(screen.queryByTestId('quiz-gameplay-ad-footer')).toBeNull();
    expect(JSON.stringify(view.toJSON())).toContain('medium-rectangle');
  });
});
