import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import type { Data } from '@puckeditor/core';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopilotBuilderActions } from './use-copilot-builder-actions';

vi.mock('@copilotkit/react-core', () => ({
  useCopilotAction: vi.fn(),
  useCopilotReadable: vi.fn(),
}));

vi.mock('./component-schema', () => ({
  COMPONENT_SCHEMA: { FAQ: { type: 'FAQ' }, Hero: { type: 'Hero' } },
}));

type RegisteredBuilderAction = {
  handler: (args: Record<string, unknown>) => string;
  name: string;
};

function getRegisteredAction(name: string): RegisteredBuilderAction {
  const registration = vi
    .mocked(useCopilotAction)
    .mock.calls.map(([config]) => config as unknown as RegisteredBuilderAction)
    .find((config) => config.name === name);
  if (!registration) throw new Error(`Expected ${name} action`);
  return registration;
}

describe('useCopilotBuilderActions defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1234);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers readable builder state for the assistant', () => {
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            { props: { id: 'hero-1', title: 'Welcome' }, type: 'Hero' },
          ],
          root: { props: {} },
        } as Data,
        setData: vi.fn(),
      })
    );

    expect(useCopilotReadable).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('current storefront'),
        value: expect.stringContaining('Welcome'),
      })
    );
  });

  it('adds FAQ manifest defaults when no props are supplied', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: { content: [], root: { props: {} } } as Data,
        setData,
      })
    );

    expect(
      getRegisteredAction('addComponent').handler({ componentType: 'FAQ' })
    ).toBe('Added FAQ at position bottom.');
    expect(setData).toHaveBeenCalledWith({
      content: [
        {
          props: expect.objectContaining({
            id: 'FAQ-1234',
            items: [
              { answer: 'Answer this question.', question: 'A question' },
            ],
          }),
          type: 'FAQ',
        },
      ],
      root: { props: {} },
    });
  });

  it('reports discarded add props while inserting safe Hero defaults', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: { content: [], root: { props: {} } } as Data,
        setData,
      })
    );

    expect(
      getRegisteredAction('addComponent').handler({
        componentType: 'Hero',
        props:
          '{"backgroundImage":"https://cdn.example.test/hero.png","ctaLink":"javascript:alert(1)","subtitle":"Seasonal collection","unreviewed":"value"}',
      })
    ).toBe(
      'Media changes require Baci manual asset controls. Ignored unsafe Hero URL. Ignored unsupported Hero fields. Added Hero at position bottom.'
    );
    expect(setData).toHaveBeenCalledWith({
      content: [
        {
          props: expect.objectContaining({
            ctaLink: '/products',
            id: 'Hero-1234',
            subtitle: 'Seasonal collection',
            title: 'Featured collection',
          }),
          type: 'Hero',
        },
      ],
      root: { props: {} },
    });
  });

  it.each([
    [
      'media-only props',
      '{"backgroundImage":"https://cdn.example.test/hero.png"}',
      'Media changes require Baci manual asset controls.',
    ],
    [
      'an unsafe URL',
      '{"ctaLink":"javascript:alert(1)"}',
      'Ignored unsafe Hero URL.',
    ],
    [
      'unsupported props',
      '{"unreviewed":"value"}',
      'Ignored unsupported Hero fields.',
    ],
  ])('does not write unchanged Hero for %s', (_condition, updates, warning) => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            { props: { id: 'hero-1', title: 'Original' }, type: 'Hero' },
          ],
          root: { props: {} },
        } as Data,
        setData,
      })
    );

    expect(
      getRegisteredAction('updateComponent').handler({ index: 0, updates })
    ).toBe(`${warning} No safe changes for Hero.`);
    expect(setData).not.toHaveBeenCalled();
  });

  it('does not write an equal structured FAQ items update', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            {
              props: {
                id: 'faq-1',
                items: [
                  { answer: 'Answer this question.', question: 'A question' },
                ],
              },
              type: 'FAQ',
            },
          ],
          root: { props: {} },
        } as Data,
        setData,
      })
    );

    expect(
      getRegisteredAction('updateComponent').handler({
        index: 0,
        updates:
          '{"items":[{"answer":"Answer this question.","question":"A question"}]}',
      })
    ).toBe('No safe changes for FAQ.');
    expect(setData).not.toHaveBeenCalled();
  });

  it('reports discarded media while applying a safe update', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            { props: { id: 'hero-1', title: 'Original' }, type: 'Hero' },
          ],
          root: { props: {} },
        } as Data,
        setData,
      })
    );

    expect(
      getRegisteredAction('updateComponent').handler({
        index: 0,
        updates:
          '{"backgroundImage":"https://cdn.example.test/hero.png","title":"Updated"}',
      })
    ).toBe(
      'Media changes require Baci manual asset controls. Updated component at index 0.'
    );
    expect(setData).toHaveBeenCalledWith({
      content: [{ props: { id: 'hero-1', title: 'Updated' }, type: 'Hero' }],
      root: { props: {} },
    });
  });
});
