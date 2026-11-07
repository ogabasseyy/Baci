import { classifyObservationLatency } from './classify-observation-latency';

it('enforces the observation contract', () => {
  expect(classifyObservationLatency(250)).toBe('250ms_to_1s');
});
