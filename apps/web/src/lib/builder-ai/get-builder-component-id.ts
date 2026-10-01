export function getBuilderComponentId(component: unknown): string | undefined {
  if (typeof component !== 'object' || component === null) return undefined;
  const props = (component as { props?: unknown }).props;
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return undefined;
  }
  const id = (props as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}
