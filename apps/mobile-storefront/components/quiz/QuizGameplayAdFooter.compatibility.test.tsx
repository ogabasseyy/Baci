import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-google-mobile-ads', () => {
  throw new Error('TurboModuleRegistry could not find RNGoogleMobileAdsModule');
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
jest.mock('@/config/quiz-mobile-ads', () => ({
  getQuizMobileAdsConfig: () => ({ enabled: true }),
}));
jest.mock('@/hooks/use-quiz-mobile-ads', () => ({
  useQuizMobileAds: () => ({
    bannerUnitId: null,
    canRequestAds: false,
    enabled: false,
    initialized: false,
  }),
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

describe('QuizGameplayAdFooter dev-build compatibility', () => {
  it('does not load the native ads package when the installed client lacks it', () => {
    expect(() => {
      const { QuizGameplayAdFooter } =
        require('./QuizGameplayAdFooter') as typeof import('./QuizGameplayAdFooter');
      render(React.createElement(QuizGameplayAdFooter, { active: true }));
    }).not.toThrow();
  });
});
