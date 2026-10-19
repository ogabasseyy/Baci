import { trackSubmittedCheckoutGeneration } from './track-submitted-checkout-generation';

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

it('tracks the submitted generation once createOrder resolves it', () => {
  const submitted = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tracker = trackSubmittedCheckoutGeneration(generation);
  // No order exists before createOrder returns: the snapshot stays.
  expect(tracker.current()).toBe(generation);
  tracker.track({ effectiveCheckoutGeneration: submitted });
  expect(tracker.current()).toBe(submitted);
});

it('keeps the snapshot when the response carries no resolved generation', () => {
  const tracker = trackSubmittedCheckoutGeneration(generation);
  tracker.track({});
  expect(tracker.current()).toBe(generation);
});
