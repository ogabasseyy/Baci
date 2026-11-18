import { markProductEntryTiming } from './product-entry-timing';

const original = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
afterEach(() => {
  if (original === undefined) delete process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  else process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = original;
  jest.restoreAllMocks();
});
it.each([
  'production',
  'development',
  undefined,
])('does not log in %s', (environment) => {
  if (environment === undefined)
    delete process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  else process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = environment;
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  markProductEntryTiming('waiting');
  expect(log).not.toHaveBeenCalled();
});
it('logs only phase and rounded local time in benchmarks', () => {
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT = 'benchmark';
  jest.spyOn(performance, 'now').mockReturnValue(12.7);
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  markProductEntryTiming('transition_end');
  expect(log).toHaveBeenCalledWith(
    '[ProductEntryTiming]',
    'transition_end',
    13
  );
});
