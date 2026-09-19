import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuizAuthoringTimingFields } from './quiz-authoring-timing-fields';

const props = {
  onScheduledEndChange: vi.fn(),
  onScheduledStartChange: vi.fn(),
  onTimingKindChange: vi.fn(),
  onWindowMinutesChange: vi.fn(),
  scheduledEnd: '2026-05-20T10:05',
  scheduledStart: '2026-05-20T10:00',
  timingKind: 'scheduled' as const,
  windowMinutes: '5',
};

describe('QuizAuthoringTimingFields', () => {
  it('edits the scheduled walls in scheduled mode', () => {
    // Arrange & Act
    render(<QuizAuthoringTimingFields {...props} />);
    fireEvent.change(screen.getByLabelText(/scheduled start/i), {
      target: { value: '2026-05-20T11:00' },
    });
    fireEvent.change(screen.getByLabelText(/universal end/i), {
      target: { value: '2026-05-20T11:05' },
    });

    // Assert
    expect(props.onScheduledStartChange).toHaveBeenCalledWith(
      '2026-05-20T11:00'
    );
    expect(props.onScheduledEndChange).toHaveBeenCalledWith('2026-05-20T11:05');
    expect(screen.queryByLabelText(/universal live window/i)).toBeNull();
  });

  it('labels the scheduled walls with the policy timezone', () => {
    // Arrange & Act: the offset-free values are Lagos wall clocks, so the
    // labels must say so for admins outside Africa/Lagos.
    render(<QuizAuthoringTimingFields {...props} />);

    // Assert
    expect(
      screen.getByLabelText(/scheduled start \(africa\/lagos\)/i)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/universal end \(africa\/lagos\)/i)
    ).toBeInTheDocument();
  });

  it('edits the live window and switches modes in immediate mode', () => {
    // Arrange & Act
    render(<QuizAuthoringTimingFields {...props} timingKind="immediate" />);
    fireEvent.change(screen.getByLabelText(/universal live window/i), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText(/launch timing/i), {
      target: { value: 'scheduled' },
    });

    // Assert
    expect(props.onWindowMinutesChange).toHaveBeenCalledWith('10');
    expect(props.onTimingKindChange).toHaveBeenCalledWith('scheduled');
    expect(screen.queryByLabelText(/scheduled start/i)).toBeNull();
  });
});
