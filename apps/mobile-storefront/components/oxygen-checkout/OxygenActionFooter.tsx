import {
  type ComponentRef,
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

const RegisterFooter = createContext<
  ((owner: symbol, node: ReactNode) => void) | null
>(null);
export const OxygenFooterVisibility = createContext(true);

/** Holds actions outside the scrolling content, inside the screen's safe area. */
export function OxygenActionFooterProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [footer, setFooter] = useState<{
    owner: symbol;
    node: ReactNode;
  } | null>(null);
  const [register] = useState(() => (owner: symbol, node: ReactNode) => {
    setFooter((current) =>
      node === null
        ? current?.owner === owner
          ? null
          : current
        : { owner, node }
    );
  });
  const colors = useOxygenColors();
  const container = useRef<ComponentRef<typeof View>>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  return (
    <RegisterFooter value={register}>
      <View
        ref={container}
        style={{ flex: 1 }}
        onLayout={() =>
          container.current?.measureInWindow((_x, y) => setHeaderHeight(y))
        }
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={headerHeight}
        >
          {children}
          {footer ? (
            <View
              style={{
                gap: 10,
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: colors.background,
              }}
            >
              {footer.node}
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </RegisterFooter>
  );
}

/** Inline fallback keeps standalone screens and previews usable. */
export function OxygenActionFooter({ children }: { children: ReactNode }) {
  const register = useContext(RegisterFooter);
  const visible = useContext(OxygenFooterVisibility);
  const [owner] = useState(() => Symbol());
  useLayoutEffect(() => {
    if (!register || !visible) return;
    register(owner, children);
    return () => register(owner, null);
  }, [register, children, visible, owner]);
  return register || !visible ? null : (
    <View style={{ gap: 10 }}>{children}</View>
  );
}
