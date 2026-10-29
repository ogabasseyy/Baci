import { describe, expect, it } from 'vitest';
import { getCandidateQualitiesForRequest } from './get-candidate-qualities-for-request';

describe('getCandidateQualitiesForRequest', () => {
  it('returns descending quality steps for 384w mobile AVIF requests and single quality otherwise', () => {
    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'avif',
        quality: 70,
        width: 384,
      })
    ).toEqual([70, 60, 50]);

    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'avif',
        quality: 70,
        width: 1080,
      })
    ).toEqual([70]);

    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'jpeg',
        quality: 70,
        width: 384,
      })
    ).toEqual([70]);
  });
});
