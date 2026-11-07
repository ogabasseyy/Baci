type Encouragement = { body: string; title: string };

/** Friendly line for how far along a goal is. Never promises a return. */
export function getSavingsEncouragement(
  percent: number,
  savedAmount = 0
): Encouragement {
  if (percent >= 100) {
    return {
      title: 'Goal reached!',
      body: 'You did it. Time to celebrate your savings.',
    };
  }
  if (percent >= 75) {
    return {
      title: 'Almost there!',
      body: 'The finish line is in sight. Keep going.',
    };
  }
  if (percent >= 50) {
    return {
      title: 'Halfway there!',
      body: "Look at you go. You're over the hump.",
    };
  }
  if (percent >= 25) {
    return {
      title: 'A quarter of the way!',
      body: 'Nice momentum. Every top-up gets you closer.',
    };
  }
  if (percent === 0 && savedAmount > 0) {
    return {
      title: 'Your plan is growing',
      body: 'Small steps add up. Keep it going.',
    };
  }
  if (percent > 0 || savedAmount > 0) {
    return {
      title: 'Great start!',
      body: 'Small steps add up. Keep it going.',
    };
  }
  return {
    title: 'Every naira counts',
    body: 'Start with any amount.',
  };
}
