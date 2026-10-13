import { describe, expect, it } from 'vitest';
import { findSemanticTarget } from './find-semantic-target';
import type { SemanticNode } from './semantic-types';

const accessibilityTree: readonly SemanticNode[] = [
  { accessibilityLabel: 'Email', accessibilityRole: 'textbox' },
  { accessibilityLabel: 'Password', accessibilityRole: 'textbox' },
  {
    accessibilityLabel: 'Sign in to your account',
    accessibilityRole: 'button',
  },
  {
    accessibilityLabel: 'Forgot password? Reset your password',
    accessibilityRole: 'link',
  },
];

describe('findSemanticTarget', () => {
  it('resolves the current login action by exact accessible label and role', () => {
    expect(
      findSemanticTarget(accessibilityTree, {
        label: 'Sign in to your account',
        role: 'button',
      })
    ).toEqual(accessibilityTree[2]);
  });

  it('does not fall back to a partial text match', () => {
    expect(() =>
      findSemanticTarget(accessibilityTree, {
        label: 'Sign in',
        role: 'button',
      })
    ).toThrow('was not found in the accessibility tree');
  });

  it('rejects duplicate exact matches instead of selecting one arbitrarily', () => {
    expect(() =>
      findSemanticTarget(
        [
          { accessibilityLabel: 'Continue', accessibilityRole: 'button' },
          { accessibilityLabel: 'Continue', accessibilityRole: 'button' },
        ],
        { label: 'Continue', role: 'button' }
      )
    ).toThrow('matched 2 nodes in the accessibility tree');
  });

  it('fails when either normalized or native disabled state is present', () => {
    expect(() =>
      findSemanticTarget(
        [
          {
            accessibilityLabel: 'Sign in to your account',
            accessibilityRole: 'button',
            accessibilityState: { disabled: true },
          },
        ],
        { label: 'Sign in to your account', role: 'button' }
      )
    ).toThrow('is disabled');

    expect(() =>
      findSemanticTarget(
        [
          {
            accessibilityLabel: 'Sign in to your account',
            accessibilityRole: 'button',
            enabled: false,
          },
        ],
        { label: 'Sign in to your account', role: 'button' }
      )
    ).toThrow('is disabled');
  });
});
