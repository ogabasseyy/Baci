import type { BuilderData } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { normalizeBuilderAiComponentIds } from './normalize-builder-ai-component-ids';

describe('normalizeBuilderAiComponentIds', () => {
  it('assigns server ids to editable root and zone components missing props.id', () => {
    const config: BuilderData = {
      content: [{ props: { title: 'Root copy' }, type: 'Text' }],
      root: { title: 'Home' },
      zones: { aside: [{ props: { title: 'Zone copy' }, type: 'Text' }] },
    };
    let sequence = 0;

    const normalized = normalizeBuilderAiComponentIds(
      config,
      (type) => `${type.toLowerCase()}-${++sequence}`
    );

    expect(normalized.content[0]?.props.id).toBe('text-1');
    expect(
      (normalized.zones?.aside as BuilderData['content'])[0]?.props.id
    ).toBe('text-2');
    expect(config.content[0]?.props.id).toBeUndefined();
  });

  it('defaults props and ids for zoned legacy blocks before prompt projection', () => {
    const normalized = normalizeBuilderAiComponentIds(
      {
        content: [],
        root: { title: 'Home' },
        zones: { aside: [{ type: 'Text' }] },
      } as BuilderData,
      () => 'zone-text'
    );

    expect(normalized.zones?.aside).toEqual([
      { props: { id: 'zone-text' }, type: 'Text' },
    ]);
  });

  it('replaces whitespace-padded and oversized legacy ids with bounded ids', () => {
    const normalized = normalizeBuilderAiComponentIds(
      {
        content: [
          { props: { id: ' padded ' }, type: 'Text' },
          { props: { id: 'x'.repeat(121) }, type: 'Text' },
        ],
        root: { title: 'Home' },
      },
      (type) => `safe-${type}`
    );

    expect(normalized.content.map((component) => component.props.id)).toEqual([
      'safe-Text',
      'safe-Text',
    ]);
  });

  it('rekeys nested zones when a parent component id is replaced', () => {
    const normalized = normalizeBuilderAiComponentIds(
      {
        content: [{ props: { id: ' padded ' }, type: 'Flex' }],
        root: { title: 'Home' },
        zones: {
          ' padded :children': [{ props: { id: 'child-text' }, type: 'Text' }],
        },
      },
      () => 'safe-flex'
    );

    expect(normalized.content[0]?.props.id).toBe('safe-flex');
    expect(normalized.zones).toEqual({
      'safe-flex:children': [{ props: { id: 'child-text' }, type: 'Text' }],
    });
  });

  it('keeps a zone bound to its root parent when a child shares its legacy id', () => {
    let sequence = 0;
    const normalized = normalizeBuilderAiComponentIds(
      {
        content: [{ props: { id: ' padded ' }, type: 'Flex' }],
        root: { title: 'Home' },
        zones: {
          ' padded :children': [{ props: { id: ' padded ' }, type: 'Text' }],
        },
      },
      (type) => `${type.toLowerCase()}-${++sequence}`
    );

    expect(normalized.content[0]?.props.id).toBe('flex-1');
    expect(normalized.zones).toEqual({
      'flex-1:children': [{ props: { id: 'text-2' }, type: 'Text' }],
    });
  });

  it('rekeys a nested zone owned by a parent inside another zone', () => {
    const normalized = normalizeBuilderAiComponentIds(
      {
        content: [{ props: { id: 'root' }, type: 'Flex' }],
        root: { title: 'Home' },
        zones: {
          ' padded :children': [{ props: { id: 'child' }, type: 'Text' }],
          'root:children': [{ props: { id: ' padded ' }, type: 'Flex' }],
        },
      },
      () => 'nested-flex'
    );

    expect(normalized.zones).toEqual({
      'nested-flex:children': [{ props: { id: 'child' }, type: 'Text' }],
      'root:children': [{ props: { id: 'nested-flex' }, type: 'Flex' }],
    });
  });
});
