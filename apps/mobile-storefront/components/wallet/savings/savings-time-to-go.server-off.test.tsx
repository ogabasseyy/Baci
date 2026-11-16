import { LONG_PLAN_DAYS, timeToGo } from './savings-time-to-go';

// Pure wording helper: it reads nothing from the server, so it answers the
// same whether PiggyVest is on or off.
describe('timeToGo', () => {
  it('counts days up to six months', () => {
    expect(timeToGo(1)).toBe('1 day');
    expect(timeToGo(180)).toBe('180 days');
  });

  it('switches to months, then years past two years', () => {
    expect(timeToGo(300)).toBe('10 months');
    expect(timeToGo(15188)).toBe('42 years');
  });

  it('nudges plans longer than two years', () => {
    expect(LONG_PLAN_DAYS).toBe(730);
  });
});
