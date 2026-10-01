# Android ANR timeline tracing

Sentry's native integration remains the production post-mortem source for
`ApplicationExitInfo` ANR traces on Android 11 and newer. Those traces are stack
snapshots, not complete timelines.

For exact attribution on Android 12, record one focused reproduction with
Perfetto. Release builds are profileable from ADB and emit `baci.surface.*`
async slices while tracing is active. The slices contain only bounded technical
metadata such as surface name, renderer, instance ID, and API level.

```bash
PACKAGE=com.ogabassey.store
TRACE_DEVICE=/data/misc/perfetto-traces/baci-anr.perfetto-trace

adb shell perfetto \
  --background-wait \
  -o "$TRACE_DEVICE" \
  -t 45s \
  --app "$PACKAGE" \
  sched freq idle am wm gfx view binder_driver hal dalvik

# Launch or navigate into exactly one flow after tracing starts, then pull it.
adb pull "$TRACE_DEVICE" ./baci-anr.perfetto-trace
```

Open the result in [Perfetto](https://ui.perfetto.dev). Correlate the active
`baci.surface.home` and `baci.surface.gadget_pattern` slices with the main and
render threads, Fabric mounting, Reanimated work, frame deadlines, Binder
transactions, garbage collection, CPU scheduling, and memory pressure.

Do not treat an active surface slice as root-cause proof. It establishes what
was mounted while the system timeline identifies the blocking work.
