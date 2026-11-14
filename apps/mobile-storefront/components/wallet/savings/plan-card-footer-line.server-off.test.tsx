import { planCardFooterLine } from './plan-card-footer-line';

describe('planCardFooterLine with PiggyVest off', () => {
  it('nudges a first contribution on a ready plan with nothing saved', () => {
    expect(planCardFooterLine(null, false)).toBe(
      'Start with your first contribution'
    );
    expect(planCardFooterLine(null, true)).toBeNull();
  });

  it.each([
    ['checking', 'Checking your plan…'],
    ['getting_ready', 'Getting your plan ready'],
    ['needs_setup', 'Finish setting up your plan'],
    ['needs_help', 'We couldn’t finish your plan setup'],
  ] as const)('names the setup state %s instead of inviting a contribution', (state, line) => {
    expect(planCardFooterLine(state, false)).toBe(line);
    expect(planCardFooterLine(state, true)).toBe(line);
  });
});

describe('bugfix: the plan card kept checking while the server was down (walk 15)', () => {
  it('says it cannot check the plan right now', () => {
    expect(planCardFooterLine('unreachable', true)).toBe(
      'Can’t check your plan right now'
    );
  });
});
