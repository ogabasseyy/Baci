import type { BuilderData } from '@baci/shared/contracts';

export function applyBuilderAiRootTitle(
  root: BuilderData['root'],
  title: string
): { changed: boolean; root: BuilderData['root'] } {
  const props = root.props as Record<string, unknown> | undefined;
  const renderedTitle = props?.title ?? root.title;
  if (renderedTitle === title) {
    return { changed: false, root };
  }
  return {
    changed: true,
    root: {
      ...root,
      props: props ? { ...props, title } : root.props,
      title,
    },
  };
}
