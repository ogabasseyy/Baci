import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { getQuizScallopCount, QuizTicketBackdrop } from './QuizTicketBackdrop';

describe('QuizTicketBackdrop', () => {
  it('adds scallops as the edge grows so they stay round', () => {
    expect(getQuizScallopCount(140)).toBe(10);
    expect(getQuizScallopCount(280)).toBe(20);
    expect(getQuizScallopCount(0)).toBe(2);
  });

  it('draws no scallops until it knows its size, then fits them to it', () => {
    render(<QuizTicketBackdrop color="#FFFFFF" />);
    const backdrop = screen.getByTestId('quiz-ticket-backdrop');
    const before = JSON.stringify(screen.toJSON()).length;
    fireEvent(backdrop, 'layout', {
      nativeEvent: { layout: { height: 154, width: 294 } },
    });
    const after = JSON.stringify(screen.toJSON()).length;
    expect(after).toBeGreaterThan(before);
  });
});
