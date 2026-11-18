import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGuide } = vi.hoisted(() => ({ mockGuide: vi.fn() }));

vi.mock('@/ai/flows/guide-business-onboarding', () => ({
  guideBusinessOnboarding: mockGuide,
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { BusinessNameGeneratorModal } from './business-name-generator-modal';

describe('BusinessNameGeneratorModal Enter to generate', () => {
  beforeEach(() => {
    mockGuide.mockReset();
    mockGuide.mockResolvedValue({ businessNames: ['Brew Haven'] });
  });

  it('does not generate names when Enter confirms IME composition', async () => {
    render(
      <BusinessNameGeneratorModal
        isOpen
        onOpenChange={vi.fn()}
        onNameSelect={vi.fn()}
      />
    );
    const input = screen.getByLabelText('Description');
    fireEvent.change(input, { target: { value: 'A cozy coffee shop' } });

    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
      false
    );
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(
      false
    );
    expect(mockGuide).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Brew Haven')).toBeInTheDocument();
    });
    expect(mockGuide).toHaveBeenCalledTimes(1);
  });
});
