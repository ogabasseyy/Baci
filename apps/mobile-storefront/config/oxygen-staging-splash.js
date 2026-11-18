// This development client uses Expo's launch screen, not SplashMotion.
module.exports = Object.freeze({
  isVisible: () => false,
  hide: () => Promise.resolve(),
  waitForIntro: () => Promise.resolve(),
});
