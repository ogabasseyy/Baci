import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

jest.mock('react-native-google-mobile-ads', () => ({
  BannerAd: 'BannerAd',
  BannerAdSize: {
    LARGE_ANCHORED_ADAPTIVE_BANNER: 'large-anchored-adaptive-banner',
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 12, left: 0, right: 0, top: 0 }),
}));
jest.mock('@/config/quiz-mobile-ads', () => ({
  getQuizMobileAdsConfig: () => ({
    bannerUnitId: 'ca-app-pub-3940256099942544/9214589741',
    enabled: true,
  }),
}));
const mockUseQuizMobileAds = jest.fn(
  (_input: { ageVerified?: boolean; requested: boolean }) => ({
    bannerUnitId: 'ca-app-pub-3940256099942544/9214589741',
    canRequestAds: true,
    enabled: true,
    initialized: true,
  })
);
jest.mock('@/hooks/use-quiz-mobile-ads', () => ({
  useQuizMobileAds: (input: { ageVerified?: boolean; requested: boolean }) =>
    mockUseQuizMobileAds(input),
}));
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#000000',
      border: '#222222',
      textSecondary: '#aaaaaa',
    },
  }),
}));
jest.mock('@/services/quiz-ad-analytics', () => ({
  trackQuizAdEvent: jest.fn(),
}));

import { QuizGameplayAdFooter } from './QuizGameplayAdFooter';

describe('QuizGameplayAdFooter', () => {
  beforeEach(() => {
    mockUseQuizMobileAds.mockClear();
  });

  it('does not show an ad outside active gameplay', () => {
    render(<QuizGameplayAdFooter active={false} />);

    expect(screen.queryByTestId('quiz-gameplay-ad-footer')).toBeNull();
    expect(mockUseQuizMobileAds).toHaveBeenCalledWith(
      expect.objectContaining({ requested: false })
    );
  });

  it('shows one clearly separated sponsored placement during gameplay', () => {
    render(<QuizGameplayAdFooter active />);

    expect(screen.getByText('Sponsored')).toBeTruthy();
    expect(screen.getByTestId('quiz-gameplay-ad-footer')).toBeTruthy();
    expect(screen.getAllByTestId('quiz-banner-slot')).toHaveLength(1);
  });

  it('does not retry ad initialization after the prewarm failed', () => {
    render(<QuizGameplayAdFooter active prewarmFailed />);

    expect(screen.queryByTestId('quiz-gameplay-ad-footer')).toBeNull();
    expect(mockUseQuizMobileAds).toHaveBeenCalledWith(
      expect.objectContaining({ requested: false })
    );
  });
});
