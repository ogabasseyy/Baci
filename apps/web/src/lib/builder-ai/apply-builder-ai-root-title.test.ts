import { describe, expect, it } from 'vitest';
import { applyBuilderAiRootTitle } from './apply-builder-ai-root-title';

describe('applyBuilderAiRootTitle', () => {
  it('updates both Puck root title representations', () => {
    const result = applyBuilderAiRootTitle(
      { props: { title: 'Old' }, title: 'Old' },
      'New'
    );
    expect(result).toEqual({
      changed: true,
      root: { props: { title: 'New' }, title: 'New' },
    });
  });

  it('does not report a change when a Puck-only title already matches', () => {
    const root = { props: { title: 'Curated homepage' } };

    expect(applyBuilderAiRootTitle(root, 'Curated homepage')).toEqual({
      changed: false,
      root,
    });
  });

  it('repairs a stale Puck title when the top-level title already matches', () => {
    expect(
      applyBuilderAiRootTitle({ props: { title: 'Old' }, title: 'New' }, 'New')
    ).toEqual({
      changed: true,
      root: { props: { title: 'New' }, title: 'New' },
    });
  });

  it('treats the rendered Puck title as a no-op when legacy title is stale', () => {
    const root = { props: { title: 'Rendered title' }, title: 'Stale title' };

    expect(applyBuilderAiRootTitle(root, 'Rendered title')).toEqual({
      changed: false,
      root,
    });
  });
});
