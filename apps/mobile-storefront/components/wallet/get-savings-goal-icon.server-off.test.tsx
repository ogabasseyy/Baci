import { getSavingsGoalIcon } from './get-savings-goal-icon';

it.each([
  ['iPhone 15 Pro', 'phone-portrait-outline'],
  ['MacBook Air', 'laptop-outline'],
  ['iPad mini', 'tablet-portrait-outline'],
  ['Apple Watch', 'watch-outline'],
  ['AirPods Pro', 'headset-outline'],
  ['PlayStation 5', 'game-controller-outline'],
  ['Birthday trip', 'gift-outline'],
])('picks an icon for "%s"', (title, icon) => {
  expect(getSavingsGoalIcon(title)).toBe(icon);
});
