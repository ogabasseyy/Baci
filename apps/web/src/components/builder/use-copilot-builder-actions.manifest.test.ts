import { builderDesignCapabilities } from '@baci/shared/contracts';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import type { Data } from '@puckeditor/core';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopilotBuilderActions } from './use-copilot-builder-actions';

vi.mock('@copilotkit/react-core', () => ({
  useCopilotAction: vi.fn(),
  useCopilotReadable: vi.fn(),
}));
vi.mock('./component-schema', async () => {
  const { COMPONENT_SCHEMA } = await import('./component-schema');
  return { COMPONENT_SCHEMA };
});

describe('useCopilotBuilderActions manifest policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses CodeEmbed even when a legacy schema entry is present', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: { content: [], root: { props: {} } } as Data,
        setData,
      })
    );
    const action = vi
      .mocked(useCopilotAction)
      .mock.calls.map(
        ([config]) =>
          config as unknown as {
            handler: (args: Record<string, unknown>) => string;
            name: string;
          }
      )
      .find((config) => config.name === 'addComponent');
    if (!action) throw new Error('Expected addComponent action');
    expect(action.handler({ componentType: 'CodeEmbed' })).toBe(
      'Component type is not insertable: CodeEmbed.'
    );
    expect(setData).not.toHaveBeenCalled();
  });

  it('advertises exactly the manifest insertable types and initial schemas', () => {
    renderHook(() =>
      useCopilotBuilderActions({
        data: { content: [], root: { props: {} } } as Data,
        setData: vi.fn(),
      })
    );
    const readable = vi.mocked(useCopilotReadable).mock.calls.at(-1)?.[0] as
      | { value: string }
      | undefined;
    const addAction = vi
      .mocked(useCopilotAction)
      .mock.calls.map(
        ([config]) => config as unknown as { description: string; name: string }
      )
      .find((config) => config.name === 'addComponent');
    if (!readable || !addAction)
      throw new Error('Expected Copilot registrations');
    const advertisedTypes = Object.keys(
      JSON.parse(readable.value).availableComponents as Record<string, unknown>
    );
    const executableTypes = builderDesignCapabilities.components
      .filter(({ aiInsertable }) => aiInsertable)
      .map(({ componentType }) => componentType);

    expect(advertisedTypes).toEqual(executableTypes);
    expect(addAction.description).toBe(
      `Add a new component to the page. Available types: ${executableTypes.join(', ')}.`
    );
    expect(advertisedTypes).not.toEqual(
      expect.arrayContaining(['Header', 'Footer', 'HeroCarousel'])
    );
    const readableConfig = JSON.parse(readable.value) as {
      editableComponents: Record<string, { specialOperations?: unknown }>;
    };
    expect(
      readableConfig.editableComponents.HeroCarousel?.specialOperations
    ).toBeDefined();
  });

  it('routes HeroCarousel updates through the bounded slide operation', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            {
              props: {
                id: 'carousel-1',
                slides: [{ image: '/hero.webp', title: 'Old title' }],
              },
              type: 'HeroCarousel',
            },
          ],
          root: { props: {} },
        } as Data,
        setData,
      })
    );
    const action = vi
      .mocked(useCopilotAction)
      .mock.calls.map(
        ([config]) =>
          config as unknown as {
            handler: (args: { index: number; updates: string }) => string;
            name: string;
          }
      )
      .find((config) => config.name === 'updateComponent');
    if (!action) throw new Error('Expected updateComponent action');

    expect(
      action.handler({
        index: 0,
        updates: JSON.stringify({ slideIndex: 0, title: 'New title' }),
      })
    ).toBe('Updated carousel slide 0.');
    expect(setData).toHaveBeenCalledWith(
      expect.objectContaining({
        content: [
          expect.objectContaining({
            props: expect.objectContaining({
              slides: [
                expect.objectContaining({
                  image: '/hero.webp',
                  title: 'New title',
                }),
              ],
            }),
          }),
        ],
      })
    );
  });

  it('rejects a carousel edit that duplicates another slide title', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            {
              props: {
                id: 'carousel-1',
                slides: [{ title: 'Sale' }, { title: 'New arrivals' }],
              },
              type: 'HeroCarousel',
            },
          ],
          root: { props: {} },
        } as Data,
        setData,
      })
    );
    const action = vi
      .mocked(useCopilotAction)
      .mock.calls.map(
        ([config]) =>
          config as unknown as {
            handler: (args: { index: number; updates: string }) => string;
            name: string;
          }
      )
      .find((config) => config.name === 'updateComponent');
    if (!action) throw new Error('Expected updateComponent action');

    expect(
      action.handler({
        index: 0,
        updates: JSON.stringify({ slideIndex: 1, title: 'Sale' }),
      })
    ).toBe('Carousel slide title must be unique.');
    expect(setData).not.toHaveBeenCalled();
  });

  it('rejects carousel updates beyond the advertised five-slide bound', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: {
          content: [
            {
              props: {
                id: 'carousel-1',
                slides: Array.from({ length: 6 }, (_, index) => ({
                  title: `Slide ${index + 1}`,
                })),
              },
              type: 'HeroCarousel',
            },
          ],
          root: { props: {} },
        } as Data,
        setData,
      })
    );
    const action = vi
      .mocked(useCopilotAction)
      .mock.calls.map(
        ([config]) =>
          config as unknown as {
            handler: (args: { index: number; updates: string }) => string;
            name: string;
          }
      )
      .find((config) => config.name === 'updateComponent');
    if (!action) throw new Error('Expected updateComponent action');

    expect(
      action.handler({
        index: 0,
        updates: JSON.stringify({ slideIndex: 5, title: 'Outside bound' }),
      })
    ).toBe('Invalid carousel slide index.');
    expect(setData).not.toHaveBeenCalled();
  });
});
