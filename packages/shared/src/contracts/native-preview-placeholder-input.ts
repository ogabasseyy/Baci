import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function restoreRefusedComponent(value: unknown): unknown {
  if (!record(value) || value.type !== 'PreviewPlaceholder') return value;
  if (
    Object.keys(value).sort().join(',') !== 'props,type' ||
    !record(value.props)
  )
    return value;
  const props = value.props;
  if (
    Object.keys(props).sort().join(',') !== 'id,label' ||
    typeof props.label !== 'string'
  )
    return value;
  const suffix = ' section';
  if (!props.label.endsWith(suffix)) return value;
  const type = props.label.slice(0, -suffix.length);
  if (!builderDesignCapabilityAdapter.getCapability(type)?.refused)
    return value;
  return { type, props: { id: props.id } };
}

/** Revalidate inert native wire placeholders through the existing refusal projector. */
export function restoreNativePreviewPlaceholders(value: unknown): unknown {
  if (!record(value)) return value;
  const zones = value.zones;
  return {
    ...value,
    ...(Array.isArray(value.content)
      ? { content: value.content.map(restoreRefusedComponent) }
      : {}),
    ...(record(zones)
      ? {
          zones: Object.fromEntries(
            Object.entries(zones).map(([key, collection]) => [
              key,
              Array.isArray(collection)
                ? collection.map(restoreRefusedComponent)
                : collection,
            ])
          ),
        }
      : {}),
  };
}
