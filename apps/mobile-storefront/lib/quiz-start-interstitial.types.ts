export interface QuizStartInterstitialOptions {
  /**
   * Runs after a loaded interstitial passes the cancellation check and
   * before it is claimed or presented. Hosts cover their interactive screen
   * with a short "ad break" notice here, so the ad never appears under a
   * finger that was about to tap a button. Cancellation is checked again
   * once it resolves; a rejection abandons the load.
   */
  beforePresent?: () => Promise<void>;
  /**
   * Polled before presenting a loaded interstitial. When it returns true the
   * load is abandoned as `skipped` instead of showing an ad over live play
   * or an unmounted lobby.
   */
  isCancelled?: () => boolean;
  /**
   * Invoked when a presented interstitial closes so hosts can remount
   * banner slots withheld while the full-screen ad owned the screen.
   */
  onClosed?: () => void;
  /**
   * Invoked synchronously when LOADED claims the attempt and presentation
   * begins, before the show() bridge round-trip resolves. Hosts claim
   * fullscreen ownership here so a start boundary landing in that window
   * holds instead of starting behind the presenting ad.
   */
  onPresenting?: () => void;
}
