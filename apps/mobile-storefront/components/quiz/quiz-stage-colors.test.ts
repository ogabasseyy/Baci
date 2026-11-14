import { describe, expect, it } from '@jest/globals';
import {
  getQuizAnswerAccent,
  QUIZ_ANSWER_ACCENTS,
  QUIZ_STAGE_COLORS,
  QUIZ_TILE,
  shouldUseQuizAnswerGrid,
} from './quiz-stage-colors';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe('quiz stage colours', () => {
  it('keeps stage text readable on the stage background', () => {
    expect(
      contrast(QUIZ_STAGE_COLORS.text, QUIZ_STAGE_COLORS.background)
    ).toBeGreaterThanOrEqual(7);
  });

  it('keeps accent text readable on the stage background', () => {
    for (const accent of [
      QUIZ_STAGE_COLORS.primary,
      QUIZ_STAGE_COLORS.warning,
      QUIZ_STAGE_COLORS.success,
      QUIZ_STAGE_COLORS.error,
    ]) {
      expect(
        contrast(accent, QUIZ_STAGE_COLORS.background)
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps tile text readable on tiles', () => {
    expect(
      contrast(QUIZ_TILE.text, QUIZ_TILE.background)
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrast(QUIZ_TILE.text, QUIZ_TILE.selectedBackground)
    ).toBeGreaterThanOrEqual(7);
  });

  it('gives each of the four answers its own accent and wraps after that', () => {
    expect(new Set(QUIZ_ANSWER_ACCENTS).size).toBe(4);
    expect(getQuizAnswerAccent(0)).toBe(QUIZ_ANSWER_ACCENTS[0]);
    expect(getQuizAnswerAccent(4)).toBe(QUIZ_ANSWER_ACCENTS[0]);
  });

  it('keeps white letters readable on every answer accent', () => {
    for (const accent of QUIZ_ANSWER_ACCENTS) {
      expect(contrast('#FFFFFF', accent)).toBeGreaterThanOrEqual(3);
    }
  });

  it('bugfix: a 30-character answer was cut off in a two-line tile; it now uses rows', () => {
    expect(
      shouldUseQuizAnswerGrid([
        'A14',
        'A15',
        'A16',
        'Snapdragon 8 Gen 3 for Galaxy',
      ])
    ).toBe(false);
    expect(
      shouldUseQuizAnswerGrid(['A14', 'A15', 'A16', 'Lollipop (5.0) release'])
    ).toBe(true);
  });

  it('uses the grid for four short answers only', () => {
    expect(shouldUseQuizAnswerGrid(['A14', 'A15', 'A16', 'A17'])).toBe(true);
    expect(shouldUseQuizAnswerGrid(['Yes', 'No'])).toBe(false);
    expect(
      shouldUseQuizAnswerGrid([
        'A14',
        'A15',
        'A16',
        'An answer that is far too long to read inside a half-width tile',
      ])
    ).toBe(false);
  });
});
