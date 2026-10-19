import {
  DateOfBirthSchema,
  getDateOfBirthValidationError,
  isAdultDateOfBirth,
} from './date-of-birth';

describe('DateOfBirthSchema', () => {
  it('accepts a real, past calendar date', () => {
    expect(DateOfBirthSchema.safeParse('1990-06-15').success).toBe(true);
  });

  it('rejects a non-ISO shape', () => {
    const result = DateOfBirthSchema.safeParse('15/06/1990');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Enter your date of birth as YYYY-MM-DD'
      );
    }
  });

  it('rejects an impossible calendar date (Feb 30)', () => {
    const result = DateOfBirthSchema.safeParse('1990-02-30');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Enter a valid date');
    }
  });

  it('rejects a future date', () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    const result = DateOfBirthSchema.safeParse(`${nextYear}-01-01`);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Enter a valid date of birth'
      );
    }
  });

  it('rejects a date beyond a plausible lifespan (>120 years)', () => {
    const tooOld = new Date().getUTCFullYear() - 121;
    expect(DateOfBirthSchema.safeParse(`${tooOld}-01-01`).success).toBe(false);
  });

  it("rejects today's date to match the server RPC (v_dob >= now()::date)", () => {
    // Freeze the clock so the test and the schema derive the same "today" — an
    // independent read either side of UTC midnight would flake.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    try {
      expect(DateOfBirthSchema.safeParse('2026-07-15').success).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('getDateOfBirthValidationError', () => {
  it('returns null for a valid date of birth', () => {
    expect(getDateOfBirthValidationError('1990-06-15')).toBeNull();
  });

  it('returns a friendly message for a malformed value', () => {
    expect(getDateOfBirthValidationError('not-a-date')).toBe(
      'Enter your date of birth as YYYY-MM-DD'
    );
  });

  it('returns a friendly message for a future date', () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    expect(getDateOfBirthValidationError(`${nextYear}-01-01`)).toBe(
      'Enter a valid date of birth'
    );
  });
});

describe('isAdultDateOfBirth', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');

  it('recognizes a shopper who is already 18', () => {
    expect(isAdultDateOfBirth('2008-08-17', now)).toBe(true);
  });

  it('keeps the underage and unknown cases non-adult', () => {
    expect(isAdultDateOfBirth('2008-08-18', now)).toBe(false);
    expect(isAdultDateOfBirth(null, now)).toBe(false);
    expect(isAdultDateOfBirth('not-a-date', now)).toBe(false);
  });
});
