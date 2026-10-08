import { describe, expect, it } from 'vitest';
import { ladderCoverageIssues } from './merchant-image-pilot-preflight-manifest-ladder.mjs';

function logoLadder() {
  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp']) {
      tiers.push({ format, requestedWidth });
    }
  }
  return tiers;
}

describe('preflight manifest ladder coverage', () => {
  it('accepts the canonical logo ladder', () => {
    expect(ladderCoverageIssues(logoLadder(), 'logo')).toEqual([]);
  });

  it('rejects missing, duplicate, and foreign rungs', () => {
    expect(ladderCoverageIssues(logoLadder().slice(0, 5), 'logo')).toEqual([
      'tiers do not cover the logo ladder exactly once',
    ]);
    // An appended duplicate breaks coverage and order (the repeat sorts
    // before the tail it follows).
    expect(
      ladderCoverageIssues([...logoLadder(), logoLadder()[0]], 'logo')
    ).toEqual([
      'tiers do not cover the logo ladder exactly once',
      'tiers must list the role ladder in canonical order',
    ]);
    // A foreign first rung breaks coverage and order (512 sorts after
    // the 96 rung it displaced).
    expect(
      ladderCoverageIssues(
        logoLadder().map((tier, index) =>
          index === 0 ? { ...tier, requestedWidth: 512 } : tier
        ),
        'logo'
      )
    ).toEqual([
      'tiers do not cover the logo ladder exactly once',
      'tiers must list the role ladder in canonical order',
    ]);
    expect(ladderCoverageIssues([null], 'logo')).toEqual([
      'tiers do not cover the logo ladder exactly once',
    ]);
  });

  it('rejects reordered ladders with full coverage', () => {
    // Same set, wrong order: acceptance hashes bind positionally, so the
    // mirror must reject exactly like the schemas do.
    expect(ladderCoverageIssues([...logoLadder()].reverse(), 'logo')).toEqual([
      'tiers must list the role ladder in canonical order',
    ]);
    const swappedFormat = logoLadder().map((tier, index, tiers) =>
      index < 2 ? tiers[1 - index] : tier
    );
    expect(ladderCoverageIssues(swappedFormat, 'logo')).toEqual([
      'tiers must list the role ladder in canonical order',
    ]);
  });
});
