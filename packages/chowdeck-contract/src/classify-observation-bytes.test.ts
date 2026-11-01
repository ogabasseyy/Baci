import { classifyObservationBytes } from './classify-observation-bytes';

it('enforces the observation contract', () => {
  expect(classifyObservationBytes(16384)).toBe('16kib_to_64kib');
});
