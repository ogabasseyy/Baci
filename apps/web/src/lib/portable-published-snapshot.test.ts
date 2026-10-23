// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { home } from '../../tools/builder-preview-spike/fixtures';
import {
  createPortablePublishedSnapshot,
  verifyPortablePublishedSnapshot,
} from './portable-published-snapshot';

describe('portable public config/version snapshot', () => {
  it('binds a stable version to the same immutable normalized config', async () => {
    const first = await createPortablePublishedSnapshot(home);
    const reordered = {
      theme: home.theme,
      content: home.content,
      root: home.root,
    };
    expect(
      (await createPortablePublishedSnapshot(reordered)).publishedVersion
    ).toBe(first.publishedVersion);
    expect(first.config.content).toHaveLength(6);
    expect(Object.isFrozen(first.config.content[0].props)).toBe(true);
    expect(() => {
      first.config.content.length = 0;
    }).toThrow();
  });
  it('changes the version when rendered copy changes and rejects a mixed DTO', async () => {
    const first = await createPortablePublishedSnapshot(home);
    const modified = structuredClone(home);
    modified.root.props.title = 'Changed homepage';
    const second = await createPortablePublishedSnapshot(modified);
    expect(second.publishedVersion).not.toBe(first.publishedVersion);
    await expect(
      verifyPortablePublishedSnapshot({
        config: second.config,
        publishedVersion: first.publishedVersion,
      })
    ).rejects.toThrow('Public snapshot version mismatch');
    expect(
      (
        await verifyPortablePublishedSnapshot(
          JSON.parse(JSON.stringify(second))
        )
      ).publishedVersion
    ).toBe(second.publishedVersion);
  });
  it('rejects an unsupported renderer instead of assigning an accepted version', async () => {
    await expect(
      createPortablePublishedSnapshot({
        ...home,
        root: { props: { rendererVersion: 'custom', title: 'Home' } },
      })
    ).rejects.toThrow();
  });
});
