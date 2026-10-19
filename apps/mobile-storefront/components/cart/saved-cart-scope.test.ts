import { savedCartScopeMatches } from './saved-cart-scope';

it('matches saved-cart scopes by value across distinct objects', () => {
  // Regression: reverting to reference equality would orphan a
  // completed read whenever React recreates the scope object.
  const saved = { userId: 'user-1', generation: 2 };
  const owner = { userId: 'user-1', generation: 2 };
  expect(saved).not.toBe(owner);
  expect(savedCartScopeMatches(saved, owner)).toBe(true);
  expect(
    savedCartScopeMatches(saved, { userId: 'user-2', generation: 2 })
  ).toBe(false);
  expect(
    savedCartScopeMatches(saved, { userId: 'user-1', generation: 3 })
  ).toBe(false);
  expect(savedCartScopeMatches(null, owner)).toBe(false);
});
