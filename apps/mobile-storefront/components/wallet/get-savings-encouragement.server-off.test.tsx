import { getSavingsEncouragement } from './get-savings-encouragement';

it.each([
  [0, 'Every naira counts'],
  [1, 'Great start!'],
  [24, 'Great start!'],
  [25, 'A quarter of the way!'],
  [50, 'Halfway there!'],
  [75, 'Almost there!'],
  [99, 'Almost there!'],
  [100, 'Goal reached!'],
])('at %i percent says "%s"', (percent, title) => {
  expect(getSavingsEncouragement(percent).title).toBe(title);
});

it('invites a contribution at zero and never promises returns', () => {
  expect(getSavingsEncouragement(0).body).toBe('Start with any amount.');
  for (const percent of [0, 10, 30, 60, 80, 100]) {
    const { body, title } = getSavingsEncouragement(percent);
    expect(`${title} ${body}`).not.toMatch(/interest|return|earn|profit/i);
  }
});

it('recognizes saved money when its floored progress is below one percent', () => {
  expect(getSavingsEncouragement(0, 400)).toEqual({
    title: 'Your plan is growing',
    body: 'Small steps add up. Keep it going.',
  });
});
