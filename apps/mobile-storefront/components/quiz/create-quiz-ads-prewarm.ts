const QUIZ_ADS_PREWARM_TIMEOUT_MS = 1500;
const QUIZ_ADS_CONSENT_TIMEOUT_MS = 10_000;

export type QuizAdsPreparationOptions = { ageVerified?: boolean };

export type PrepareQuizMobileAds = ((
  signal: AbortSignal,
  options?: QuizAdsPreparationOptions
) => Promise<boolean>) & {
  prepareConsent?: () => Promise<void>;
};

export function createQuizAdsPrewarm(
  prepare: PrepareQuizMobileAds,
  onFinished: (failed: boolean, consentTimedOut?: boolean) => void,
  options?: QuizAdsPreparationOptions
): { cancel: () => void; promise: Promise<boolean> } {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let consentTimeout: ReturnType<typeof setTimeout> | null = null;
  let consentTimedOut = false;
  const startPreparation = () => {
    const preparation = Promise.resolve()
      .then(() => prepare(controller.signal, options))
      .then((result) => result !== false)
      .catch(() => false);
    const timeoutResult = new Promise<false>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, QUIZ_ADS_PREWARM_TIMEOUT_MS);
    });
    return Promise.race([preparation, timeoutResult]);
  };
  const waitForConsent = () => {
    const consent = Promise.resolve()
      .then(() => prepare.prepareConsent?.())
      .then(() => true)
      .catch(() => true);
    const timeoutResult = new Promise<false>((resolve) => {
      consentTimeout = setTimeout(() => {
        consentTimedOut = true;
        resolve(false);
      }, QUIZ_ADS_CONSENT_TIMEOUT_MS);
    });
    return Promise.race([consent, timeoutResult]).finally(() => {
      if (consentTimeout) clearTimeout(consentTimeout);
    });
  };
  const preparation = prepare.prepareConsent
    ? waitForConsent().then((consentReady) =>
        consentReady ? startPreparation() : false
      )
    : startPreparation();
  const promise = preparation
    .then((prepared) => {
      if (consentTimedOut) onFinished(true, true);
      else onFinished(!prepared);
      return prepared;
    })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
      if (consentTimeout) clearTimeout(consentTimeout);
    });
  return { cancel: () => controller.abort(), promise };
}
