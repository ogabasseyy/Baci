import { describe, expect, it } from 'vitest';
import { normaliseMonnifyWording } from './monnify-text-normalise';

describe('normaliseMonnifyWording', () => {
  it.each([
    ['vendInProgress', 'vend In Progress'],
    ['referenceAlreadyExists', 'reference Already Exists'],
    ['INVALID_TOKEN', 'INVALID TOKEN'],
    ['reference-already-exists', 'reference already exists'],
    ['Insufficient wallet balance', 'Insufficient wallet balance'],
  ])('reads %s as %s', (input, expected) => {
    expect(normaliseMonnifyWording(input)).toBe(expected);
  });
});
