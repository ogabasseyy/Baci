// Global safe-area defaults, side-effect imported by jest.setup.ts. Kept
// separate per the Boy Scout Rule: the setup file is over the 300-line
// budget, so touched mock groups live in dedicated setup modules instead
// of extending it further.

// `useSafeAreaInsets` throws without a `SafeAreaProvider` ancestor, but most
// suites render screens in isolation. Default the insets to zero globally;
// suites needing nonzero insets still override with a per-file `jest.mock`.
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});
