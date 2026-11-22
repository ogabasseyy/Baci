import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';
import { View } from 'react-native';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
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
  return (
    <RegisterFooter value={register}>
      <AppKeyboardContainer>
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
      </AppKeyboardContainer>
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
