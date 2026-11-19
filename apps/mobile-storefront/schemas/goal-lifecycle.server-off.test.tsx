import { GoalLifecycleSchemas } from './goal-lifecycle';

// With the server keeping PiggyVest off, no request is ever built: the
// schemas only describe bodies and send nothing.
describe('server keeps PiggyVest off', () => {
  it('is a pure description of bodies: parsing sends nothing and a not-ready error body is no valid answer', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(
      GoalLifecycleSchemas.issueResponse.cancel.safeParse({
        error: 'not ready',
        code: 'PIGGYVEST_NOT_READY',
      }).success
    ).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
