import type {} from './hooks/use-openai-global';

type WidgetHost = NonNullable<Window['openai']>;
type WidgetHostOverrides = Partial<WidgetHost>;

let overrides: WidgetHostOverrides | undefined;

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

const syncHostGlobals = (event: Event) => {
  const globals = (event as CustomEvent<{ globals?: WidgetHostOverrides }>)
    .detail?.globals;
  if (globals) overrides = { ...overrides, ...globals };
};

if (typeof window !== 'undefined')
  window.addEventListener('openai:set_globals', syncHostGlobals);

/** Keep standard adapter values live while preserving the host-owned bridge. */
function get(): WidgetHost | undefined {
  return overrides ? adapter : window.openai;
}

/** Clear standard adapter values when the standard handshake is rejected. */
function reset() {
  overrides = undefined;
}

/** Apply a standard bridge update and notify the widget's external-store hooks. */
function update(globals: WidgetHostOverrides) {
  overrides = { ...overrides, ...globals };
  window.dispatchEvent(
    new CustomEvent('openai:set_globals', { detail: { globals } })
  );
}

export const widgetHost = { get, reset, update };
