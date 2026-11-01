import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  NativeCustomizePreviewPane,
  type NativeCustomizePreviewPaneProps,
} from './NativeCustomizePreviewPane';
import {
  initialPreviewSlots,
  reducePreviewSlots,
} from './native-preview-slots';

type Snapshot = { id: number; input: NativeCustomizePreviewPaneProps };

export function BufferedNativeCustomizePreviewPane(
  input: NativeCustomizePreviewPaneProps
) {
  const nextId = useRef(1);
  const latest = useRef(input);
  const [slots, setSlots] = useState<Snapshot[]>([{ id: 1, input }]);
  const [state, dispatch] = useReducer(reducePreviewSlots, {
    ...initialPreviewSlots,
    pending: 1,
  });
  const lastRevision = useRef(input.draftRevision);
  const visible = useRef<number | null>(null);
  useLayoutEffect(() => {
    latest.current = input;
    visible.current = state.visible;
    if (lastRevision.current !== input.draftRevision) {
      lastRevision.current = input.draftRevision;
      const id = ++nextId.current;
      setSlots((old) => [
        ...old.filter((slot) => slot.id === visible.current),
        { id, input },
      ]);
      dispatch({ type: 'start', slot: id });
    }
  }, [input, state.visible]);
  useEffect(() => {
    setSlots((old) =>
      old.filter(
        (slot) => slot.id === state.visible || slot.id === state.pending
      )
    );
  }, [state.visible, state.pending]);
  const retry = () => {
    const id = ++nextId.current;
    setSlots((old) => [
      ...old.filter((slot) => slot.id === visible.current),
      { id, input: latest.current },
    ]);
    dispatch({ type: 'start', slot: id });
  };
  return (
    <View
      style={{ flex: 1, position: 'relative' }}
      accessibilityLabel="Storefront preview"
    >
      {slots.map((slot) => (
        <View
          key={slot.id}
          pointerEvents={slot.id === state.visible ? 'auto' : 'none'}
          importantForAccessibility={
            slot.id === state.visible ? 'auto' : 'no-hide-descendants'
          }
          style={{
            position: 'absolute',
            inset: 0,
            opacity: slot.id === state.visible ? 1 : 0,
          }}
        >
          <NativeCustomizePreviewPane
            {...slot.input}
            onSlotRendered={() => {
              if (
                latest.current.draftRevision === slot.input.draftRevision &&
                latest.current.isIdentityCurrent()
              )
                dispatch({ type: 'rendered', slot: slot.id });
            }}
            onSlotFailure={() => dispatch({ type: 'failed', slot: slot.id })}
          />
        </View>
      ))}
      {state.visible === null && state.failed === null ? (
        <ActivityIndicator color={input.colors.primary} />
      ) : null}
      {state.failed !== null ? (
        <View>
          <Text style={{ color: input.colors.textSecondary }}>
            Preview not available
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry preview"
            onPress={retry}
          >
            <Text>Retry</Text>
          </Pressable>
          {input.onFallback ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View published store"
              onPress={input.onFallback}
            >
              <Text>View published store</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
