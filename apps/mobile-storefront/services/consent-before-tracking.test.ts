import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { isQuizMobileAdsAvailable } from '@/components/quiz/is-quiz-mobile-ads-available';
import {
  CONSENT_FORM_BACKSTOP_MS,
  CONSENT_UPDATE_WATCHDOG_MS,
  gatherConsentBeforeTracking,
} from './consent-before-tracking';
import {
  getQuizMobileAdsConsentStage,
  prepareQuizMobileAdsConsent,
} from './initialize-quiz-mobile-ads';

jest.mock('@/components/quiz/is-quiz-mobile-ads-available', () => ({
  isQuizMobileAdsAvailable: jest.fn(() => true),
}));
jest.mock('./initialize-quiz-mobile-ads', () => ({
  prepareQuizMobileAdsConsent: jest.fn(async () => undefined),
  getQuizMobileAdsConsentStage: jest.fn(() => 'updating'),
}));

const mockIsAvailable = jest.mocked(isQuizMobileAdsAvailable);
const mockStage = jest.mocked(getQuizMobileAdsConsentStage);
const mockPrepareConsent = jest.mocked(prepareQuizMobileAdsConsent);
const ORIGINAL_ADS = process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
const ORIGINAL_QUIZ_ADS = process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED;

function setEnv(ads: string | undefined, quizAds: string | undefined) {
  if (ads === undefined) delete process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED;
  else process.env.EXPO_PUBLIC_MOBILE_ADS_ENABLED = ads;
  if (quizAds === undefined) delete process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED;
  else process.env.EXPO_PUBLIC_QUIZ_ADS_ENABLED = quizAds;
}

describe('gatherConsentBeforeTracking', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockIsAvailable.mockReturnValue(true);
    mockStage.mockReturnValue('updating');
    mockPrepareConsent.mockReset();
    mockPrepareConsent.mockResolvedValue(undefined);
    setEnv(ORIGINAL_ADS, ORIGINAL_QUIZ_ADS);
  });

  it('skips without touching consent when no ads are switched on', async () => {
    setEnv(undefined, 'false');

    await expect(gatherConsentBeforeTracking()).resolves.toBe('skipped');
    expect(mockPrepareConsent).not.toHaveBeenCalled();
  });

  it('skips when the native ads module is missing', async () => {
    setEnv('true', undefined);
    mockIsAvailable.mockReturnValue(false);

    await expect(gatherConsentBeforeTracking()).resolves.toBe('skipped');
    expect(mockPrepareConsent).not.toHaveBeenCalled();
  });

  it.each([
    ['true', undefined],
    [undefined, 'true'],
  ])('gathers consent when app ads=%s or quiz ads=%s', async (ads, quizAds) => {
    setEnv(ads, quizAds);

    await expect(gatherConsentBeforeTracking()).resolves.toBe('done');
    expect(mockPrepareConsent).toHaveBeenCalledTimes(1);
  });

  it('reports an error instead of rejecting when consent fails', async () => {
    setEnv('true', undefined);
    mockPrepareConsent.mockRejectedValue(new Error('consent failed'));

    await expect(gatherConsentBeforeTracking()).resolves.toBe('error');
  });

  it('reports an error when the availability check throws', async () => {
    setEnv('true', undefined);
    mockIsAvailable.mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    await expect(gatherConsentBeforeTracking()).resolves.toBe('error');
  });

  it('gives up after the short watchdog while the consent update stalls with nothing on screen', async () => {
    jest.useFakeTimers();
    setEnv('true', undefined);
    mockStage.mockReturnValue('updating');
    mockPrepareConsent.mockReturnValue(new Promise<void>(() => undefined));

    const pending = gatherConsentBeforeTracking();
    await jest.advanceTimersByTimeAsync(CONSENT_UPDATE_WATCHDOG_MS);

    await expect(pending).resolves.toBe('timeout');
  });

  it('keeps waiting past the watchdog while the consent form is on screen', async () => {
    jest.useFakeTimers();
    setEnv('true', undefined);
    mockStage.mockReturnValue('form');
    let finish!: () => void;
    mockPrepareConsent.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );

    const outcomes: string[] = [];
    const pending = gatherConsentBeforeTracking().then((outcome) => {
      outcomes.push(outcome);
      return outcome;
    });
    await jest.advanceTimersByTimeAsync(CONSENT_UPDATE_WATCHDOG_MS * 3);
    expect(outcomes).toEqual([]);

    finish();
    await expect(pending).resolves.toBe('done');
  });

  it('stops waiting at the long backstop even if the form never closes', async () => {
    jest.useFakeTimers();
    setEnv('true', undefined);
    mockStage.mockReturnValue('form');
    mockPrepareConsent.mockReturnValue(new Promise<void>(() => undefined));

    const pending = gatherConsentBeforeTracking();
    await jest.advanceTimersByTimeAsync(CONSENT_FORM_BACKSTOP_MS);

    await expect(pending).resolves.toBe('timeout');
  });
});
