import type {} from './hooks/use-openai-global';

type WidgetHost = NonNullable<Window['openai']>;
let overrides: Partial<WidgetHost> | undefined;
const adapter: WidgetHost = new Proxy({} as WidgetHost, {
  get(_target, key) {
    if (overrides && Object.hasOwn(overrides, key))
      return Reflect.get(overrides, key);
    const native = window.openai;
    if (!native) return undefined;
    const value: unknown = Reflect.get(native, key, native);
    return typeof value === 'function' ? value.bind(native) : value;
  },
});

/** Keep the standard adapter separate from the host-owned ChatGPT extension. */
export function getWidgetHost(): WidgetHost | undefined {
  return overrides ? adapter : window.openai;
}

export function resetWidgetHost() {
  overrides = undefined;
}

export function updateWidgetHost(globals: Partial<WidgetHost>) {
  overrides = { ...overrides, ...globals };
  window.dispatchEvent(
    new CustomEvent('openai:set_globals', { detail: { globals } }),
  );
}
