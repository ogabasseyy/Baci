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
  const detail = (event as CustomEvent<{ globals?: WidgetHostOverrides; reset?: boolean }>).detail;
  // Reset notifications carry native values for re-rendering only; merging
  // them would resurrect the adapter the reset just cleared.
  if (detail?.reset) return;
  const globals = detail?.globals;
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
  const previous = overrides;
  if (!previous) return;
  overrides = undefined;
  // Notify subscribers that adapter values are gone: get() now resolves to
  // the native host, so previously overridden keys must re-render even when
  // the native host has no value for them.
  const native = window.openai;
  const globals = Object.fromEntries(
    Object.keys(previous).map((key) => [key, native?.[key as keyof NonNullable<typeof native>]])
  ) as WidgetHostOverrides;
  window.dispatchEvent(
    new CustomEvent('openai:set_globals', { detail: { globals, reset: true } })
  );
}

/** Apply a standard bridge update and notify the widget's external-store hooks. */
function update(globals: WidgetHostOverrides) {
  overrides = { ...overrides, ...globals };
  window.dispatchEvent(
    new CustomEvent('openai:set_globals', { detail: { globals } })
  );
}

export const widgetHost = { get, reset, update };
