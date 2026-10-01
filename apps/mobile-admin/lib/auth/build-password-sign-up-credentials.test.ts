import { describe, expect, it } from 'vitest';
import { buildPasswordSignUpCredentials } from './build-password-sign-up-credentials';

describe('buildPasswordSignUpCredentials', () => {
  it('normalizes names and persists only safe signup monitoring context', () => {
    expect(
      buildPasswordSignUpCredentials({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        email: 'merchant@example.com',
        firstName: 'aDA',
        lastName: 'lOVELACE',
        password: 'not-logged',
        signupFlow: 'merchant',
      })
    ).toEqual({
      email: 'merchant@example.com',
      password: 'not-logged',
      options: {
        data: {
          first_name: 'Ada',
          full_name: 'Ada Lovelace',
          last_name: 'Lovelace',
          signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
          signup_flow: 'merchant',
        },
      },
    });
  });

  it('uses normalized fullName when separate names are blank', () => {
    const credentials = buildPasswordSignUpCredentials({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      email: 'staff@example.com',
      firstName: ' ',
      fullName: '  gRACE   hOPPER ',
      lastName: '',
      password: 'not-logged',
      signupFlow: 'staff',
    });

    expect(credentials.options.data).toEqual({
      full_name: 'Grace Hopper',
      signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
      signup_flow: 'staff',
    });
  });

  it('omits all name metadata when names are blank or absent', () => {
    const credentials = buildPasswordSignUpCredentials({
      attemptId: '123e4567-e89b-42d3-a456-426614174000',
      email: 'staff@example.com',
      fullName: ' ',
      password: 'not-logged',
      signupFlow: 'staff',
    });

    expect(credentials.options.data).toEqual({
      signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
      signup_flow: 'staff',
    });
  });
});
