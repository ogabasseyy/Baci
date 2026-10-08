import { getProfileUpdateError } from './profile-update-error';

describe('profile update errors', () => {
  it('explains a duplicate phone without exposing database details', () => {
    const message = getProfileUpdateError({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "customers_merchant_phone_unique"',
    });
    expect(message).toContain('verify ownership');
    expect(message).not.toContain('customers_merchant_phone_unique');
  });

  it.each([
    undefined,
    new Error('database connection secret'),
    { code: '23505', message: 'other constraint' },
  ])('uses safe fallback copy for other failures', (error) => {
    expect(getProfileUpdateError(error)).toBe(
      'Could not update your profile. Please try again.'
    );
  });
});
