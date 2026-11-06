import { describe, expect, it } from 'vitest';
import { parseDestinationState } from './parse-chat-destination-state';

describe('parseDestinationState', () => {
  it('returns a canonical state for a clear destination', () => {
    expect(parseDestinationState('Please deliver to Lagos')).toEqual({ kind: 'matched', stateName: 'Lagos' });
    expect(parseDestinationState('I live in Niger State')).toEqual({ kind: 'matched', stateName: 'Niger' });
  });

  it('treats a state mentioned as excluded or not the destination as negated', () => {
    expect(parseDestinationState('Not Lagos')).toEqual({ kind: 'negated-state' });
    expect(parseDestinationState('Lagos is not my destination')).toEqual({ kind: 'negated-state' });
    expect(parseDestinationState('Not Lagos, I mean Ogun')).toEqual({ kind: 'negated-state' });
  });

  it('distinguishes multiple areas, ambiguous Niger, and missing state', () => {
    expect(parseDestinationState('I live between Lagos and Abuja')).toEqual({ kind: 'multiple-states' });
    expect(parseDestinationState('I am moving to Niger Republic')).toEqual({ kind: 'ambiguous-niger' });
    expect(parseDestinationState('I live in Ikeja')).toEqual({ kind: 'missing' });
  });

  it('does not treat a street number as state negation, regardless of state casing', () => {
    expect(parseDestinationState('No. 12 Long Street, Lagos')).toEqual({ kind: 'matched', stateName: 'Lagos' });
    expect(parseDestinationState('No. 12 Long Street, lagos')).toEqual({ kind: 'matched', stateName: 'Lagos' });
  });
});
