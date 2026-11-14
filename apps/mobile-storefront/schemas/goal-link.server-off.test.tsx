import { goalIdParamSchema } from './goal-link';

// Link parsing happens on the device: the same with PiggyVest on or off.
describe('goal link id with the server off', () => {
  it('accepts a UUID goal id', () => {
    expect(
      goalIdParamSchema.safeParse('0b7d3c52-6f0e-4d1a-9c2b-3e4f5a6b7c8d')
        .success
    ).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['goal 1', '', undefined, '123']) {
      expect(goalIdParamSchema.safeParse(value).success).toBe(false);
    }
  });
});
