import { useCopilotAction } from '@copilotkit/react-core';
import type { Data } from '@puckeditor/core';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopilotBuilderActions } from './use-copilot-builder-actions';

vi.mock('@copilotkit/react-core', () => ({
  useCopilotAction: vi.fn(),
  useCopilotReadable: vi.fn(),
}));

vi.mock('./component-schema', () => ({
  COMPONENT_SCHEMA: {
    CodeEmbed: { type: 'CodeEmbed' },
    Hero: { type: 'Hero' },
    ProductGrid: { type: 'ProductGrid' },
  },
}));

type BuilderActionArgs = Record<string, unknown>;

type RegisteredBuilderAction = {
  handler: (args: BuilderActionArgs) => string;
  name: string;
};

function createData(content: Data['content'] = []): Data {
  return { content, root: { props: {} } };
}

function getRegisteredAction(name: string): RegisteredBuilderAction {
  const registration = vi
    .mocked(useCopilotAction)
    .mock.calls.map(([config]) => config as unknown as RegisteredBuilderAction)
    .find((config) => config.name === name);

  if (!registration) {
    throw new Error(`Expected ${name} to be registered`);
  }

  return registration;
}

describe('useCopilotBuilderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1234);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers add, update, and remove actions', () => {
    renderHook(() =>
      useCopilotBuilderActions({ data: createData(), setData: vi.fn() })
    );

    expect(
      vi.mocked(useCopilotAction).mock.calls.map(([config]) => config.name)
    ).toEqual(['addComponent', 'updateComponent', 'removeComponent']);
  });

  it('adds a supported component with parsed props at the requested position', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([{ props: { id: 'hero-1' }, type: 'Hero' }]),
        setData,
      })
    );

    const result = getRegisteredAction('addComponent').handler({
      componentType: 'ProductGrid',
      position: 0,
      props: '{"title":"Featured"}',
    });

    expect(result).toBe('Added ProductGrid at position 0.');
    expect(setData).toHaveBeenCalledWith({
      content: [
        {
          props: expect.objectContaining({
            id: 'ProductGrid-1234',
            title: 'Featured',
          }),
          type: 'ProductGrid',
        },
        { props: { id: 'hero-1' }, type: 'Hero' },
      ],
      root: { props: {} },
    });
  });

  it('does not add unsupported components', () => {
    const setData = vi.fn();
    renderHook(() => useCopilotBuilderActions({ data: createData(), setData }));

    const result = getRegisteredAction('addComponent').handler({
      componentType: 'UnknownBlock',
    });

    expect(result).toBe('Invalid component type: UnknownBlock.');
    expect(setData).not.toHaveBeenCalled();
  });

  it('does not let model props override generated ids or bypass the manifest on add', () => {
    const setData = vi.fn();
    renderHook(() => useCopilotBuilderActions({ data: createData(), setData }));

    const result = getRegisteredAction('addComponent').handler({
      componentType: 'Hero',
      props:
        '{"ctaLink":"javascript:alert(1)","id":"model-id","title":"Safe title","unknown":"ignored"}',
    });

    expect(result).toBe(
      'Ignored unsafe Hero URL. Ignored unsupported Hero fields. Added Hero at position bottom.'
    );
    expect(setData).toHaveBeenCalledWith({
      content: [
        {
          props: expect.objectContaining({
            id: 'Hero-1234',
            title: 'Safe title',
          }),
          type: 'Hero',
        },
      ],
      root: { props: {} },
    });
  });

  it('does not create a duplicate id when an existing component has the generated id', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([{ props: { id: 'Hero-1234' }, type: 'Hero' }]),
        setData,
      })
    );

    getRegisteredAction('addComponent').handler({ componentType: 'Hero' });

    expect(setData).toHaveBeenCalledWith({
      content: [
        { props: { id: 'Hero-1234' }, type: 'Hero' },
        {
          props: expect.objectContaining({ id: 'Hero-1234-1' }),
          type: 'Hero',
        },
      ],
      root: { props: {} },
    });
  });

  it('updates a component with parsed JSON props', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([
          { props: { id: 'hero-1', title: 'Old title' }, type: 'Hero' },
        ]),
        setData,
      })
    );

    const result = getRegisteredAction('updateComponent').handler({
      index: 0,
      updates: '{"title":"New title"}',
    });

    expect(result).toBe('Updated component at index 0.');
    expect(setData).toHaveBeenCalledWith({
      content: [{ props: { id: 'hero-1', title: 'New title' }, type: 'Hero' }],
      root: { props: {} },
    });
  });

  it('does not update when the index or JSON payload is invalid', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([{ props: { id: 'hero-1' }, type: 'Hero' }]),
        setData,
      })
    );

    const updateComponent = getRegisteredAction('updateComponent');

    expect(updateComponent.handler({ index: 1, updates: '{}' })).toBe(
      'Invalid index: 1. Component not found.'
    );
    expect(updateComponent.handler({ index: 0.5, updates: '{}' })).toBe(
      'Invalid index: 0.5. Component not found.'
    );
    expect(updateComponent.handler({ index: 0, updates: 'not-json' })).toBe(
      'Failed to parse updates JSON.'
    );
    expect(setData).not.toHaveBeenCalled();
  });

  it('refuses updates to a refused component', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([{ props: { id: 'code-1' }, type: 'CodeEmbed' }]),
        setData,
      })
    );

    expect(
      getRegisteredAction('updateComponent').handler({
        index: 0,
        updates: '{"code":"<script>"}',
      })
    ).toBe('Component type is not editable: CodeEmbed.');
    expect(setData).not.toHaveBeenCalled();
  });

  it('keeps existing ids and ignores unsafe or unsupported model updates', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([
          { props: { id: 'hero-1', title: 'Old title' }, type: 'Hero' },
        ]),
        setData,
      })
    );

    const result = getRegisteredAction('updateComponent').handler({
      index: 0,
      updates:
        '{"ctaLink":"javascript:alert(1)","id":"model-id","title":"New title","unknown":"ignored"}',
    });

    expect(result).toBe(
      'Ignored unsafe Hero URL. Ignored unsupported Hero fields. Updated component at index 0.'
    );
    expect(setData).toHaveBeenCalledWith({
      content: [
        {
          props: { id: 'hero-1', title: 'New title' },
          type: 'Hero',
        },
      ],
      root: { props: {} },
    });
  });

  it('removes a component at the requested index', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([
          { props: { id: 'hero-1' }, type: 'Hero' },
          { props: { id: 'grid-1' }, type: 'ProductGrid' },
        ]),
        setData,
      })
    );

    const result = getRegisteredAction('removeComponent').handler({ index: 0 });

    expect(result).toBe('Removed Hero at index 0.');
    expect(setData).toHaveBeenCalledWith({
      content: [{ props: { id: 'grid-1' }, type: 'ProductGrid' }],
      root: { props: {} },
    });
  });

  it('refuses removal of a refused protected component', () => {
    const setData = vi.fn();
    renderHook(() =>
      useCopilotBuilderActions({
        data: createData([{ props: { id: 'code-1' }, type: 'CodeEmbed' }]),
        setData,
      })
    );

    expect(getRegisteredAction('removeComponent').handler({ index: 0 })).toBe(
      'Component type is not removable: CodeEmbed.'
    );
    expect(setData).not.toHaveBeenCalled();
  });

  it('does not remove a component for an invalid index', () => {
    const setData = vi.fn();
    renderHook(() => useCopilotBuilderActions({ data: createData(), setData }));

    expect(getRegisteredAction('removeComponent').handler({ index: 0 })).toBe(
      'Invalid index: 0'
    );
    expect(getRegisteredAction('removeComponent').handler({ index: 0.5 })).toBe(
      'Invalid index: 0.5'
    );
    expect(setData).not.toHaveBeenCalled();
  });
});
