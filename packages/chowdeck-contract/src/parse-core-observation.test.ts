import { parseCoreObservation } from './parse-core-observation';

it('enforces the observation contract', () => {
  expect(() => parseCoreObservation({ status: 'observed' })).toThrow(
    'Invalid core observation'
  );
});
