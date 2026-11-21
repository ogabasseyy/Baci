import type { OxygenTransientFile } from '@baci/shared/oxygen';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { OxygenActionFooter } from './OxygenActionFooter';
import { useOxygenDrawingControl } from './OxygenDrawingControl';
import { formatOxygenPaymentDate } from './oxygen-payment-date';
import {
  OxygenAction,
  oxygenPresentation as styles,
} from './oxygen-presentation';
import {
  clampSignaturePoint,
  type SignaturePoint,
  signaturePath,
  signaturePng,
} from './oxygen-signature';
export interface OxygenSignatureStepProps {
  termsKey: string;
  accepted: boolean;
  capturedTermsKey: string | null;
  nextPaymentDate?: string;
  disabled?: boolean;
  requestingCode?: boolean;
  onSignature: (
    file: OxygenTransientFile | undefined,
    termsKey: string
  ) => void;
  onAccept: (accepted: boolean) => void;
  onContinue: () => void;
}
/** Remount only on material terms change; expansion leaves stroke coordinates intact. */
export function OxygenSignatureStep(props: OxygenSignatureStepProps) {
  return <SignatureCanvas key={props.termsKey} {...props} />;
}
function SignatureCanvas({
  termsKey,
  accepted,
  capturedTermsKey,
  nextPaymentDate,
  disabled: controlsDisabled = false,
  requestingCode = false,
  onSignature,
  onAccept,
  onContinue,
}: OxygenSignatureStepProps) {
  const disabled = controlsDisabled || requestingCode;
  const { colors } = useTheme();
  const setDrawing = useOxygenDrawingControl();
  const drawing = useRef(false);
  const svg = useRef<Svg | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const strokes = useRef<SignaturePoint[][]>([]);
  const layout = useRef({ width: 300, height: 150 });
  const [paths, setPaths] = useState<{ id: number; path: string }[]>([]);
  const strokeIds = useRef<number[]>([]);
  function redraw() {
    setPaths(
      strokes.current.map((points, index) => ({
        id: strokeIds.current[index],
        path: signaturePath(points),
      }))
    );
  }
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
      if (drawing.current) setDrawing?.(false);
    };
  }, [setDrawing]);
  function point(x: number, y: number) {
    return clampSignaturePoint(
      (x / layout.current.width) * 300,
      (y / layout.current.height) * 150,
      300,
      150
    );
  }
  function invalidate() {
    revision.current++;
    onSignature(undefined, termsKey);
    onAccept(false);
    setError('');
  }
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled && !saving,
    onMoveShouldSetPanResponder: () => !disabled && !saving,
    onPanResponderGrant: (event) => {
      drawing.current = true;
      setDrawing?.(true);
      invalidate();
      const p = point(event.nativeEvent.locationX, event.nativeEvent.locationY);
      strokes.current.push([p, { x: Math.min(300, p.x + 0.1), y: p.y }]);
      strokeIds.current.push(revision.current);
      redraw();
    },
    onPanResponderMove: (event) => {
      const current = strokes.current[strokes.current.length - 1];
      if (!current || current.length >= 6000) return;
      current.push(
        point(event.nativeEvent.locationX, event.nativeEvent.locationY)
      );
      redraw();
    },
    onPanResponderRelease: () => {
      drawing.current = false;
      setDrawing?.(false);
    },
    onPanResponderTerminate: () => {
      drawing.current = false;
      setDrawing?.(false);
    },
  });
  function captureAcceptance() {
    if (disabled || saving) return;
    if (accepted) {
      onAccept(false);
      return;
    }
    if (!strokes.current.length || !svg.current) {
      setError('Add your signature before accepting.');
      return;
    }
    const capturedRevision = revision.current;
    setSaving(true);
    try {
      svg.current.toDataURL(
        (base64) => {
          if (!mounted.current || capturedRevision !== revision.current) return;
          setSaving(false);
          const file = signaturePng(base64);
          if (!file) {
            setError('Your signature could not be captured. Please try again.');
            return;
          }
          onSignature(file, termsKey);
          onAccept(true);
        },
        { width: 600, height: 300 }
      );
    } catch {
      setSaving(false);
      setError('Your signature could not be captured. Please try again.');
    }
  }
  const usable = accepted && capturedTermsKey === termsKey && !!nextPaymentDate;
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        Your signature
      </Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 21 }}>
        Sign in the box, then confirm the payment plan to continue.
      </Text>
      <View>
        <View
          accessibilityLabel="Draw your signature"
          style={{
            height: expanded ? 300 : 150,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 12,
            overflow: 'hidden',
          }}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            if (width > 0 && height > 0) layout.current = { width, height };
          }}
          {...responder.panHandlers}
        >
          <Svg
            ref={svg}
            width="100%"
            height="100%"
            viewBox="0 0 300 150"
            preserveAspectRatio="none"
          >
            <Rect width={300} height={150} fill={colors.card} />
            {paths.map(({ path, id }) => (
              <Path
                key={id}
                d={path}
                stroke={colors.text}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? 'Collapse signature' : 'Expand signature'
          }
          accessibilityState={{ expanded, disabled: disabled || saving }}
          disabled={disabled || saving}
          onPress={() => setExpanded((wasExpanded) => !wasExpanded)}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            backgroundColor: colors.card,
          }}
        >
          <Ionicons
            name={expanded ? 'contract-outline' : 'expand-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      <OxygenAction
        secondary
        label="Clear signature"
        disabled={disabled || saving}
        onPress={() => {
          strokes.current = [];
          strokeIds.current = [];
          setPaths([]);
          invalidate();
        }}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Accept payment plan"
        accessibilityState={{
          checked: accepted,
          disabled: disabled || saving || !nextPaymentDate,
        }}
        disabled={disabled || saving || !nextPaymentDate}
        onPress={captureAcceptance}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          padding: 12,
          minHeight: 48,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: accepted ? colors.primary : colors.border,
          backgroundColor: colors.card,
        }}
      >
        <Ionicons
          name={accepted ? 'checkbox' : 'square-outline'}
          size={24}
          color={accepted ? colors.primary : colors.textSecondary}
        />
        <Text style={{ flex: 1, color: colors.text, lineHeight: 21 }}>
          {nextPaymentDate
            ? `I accept this payment plan and understand my next payment is due on ${formatOxygenPaymentDate(nextPaymentDate)}.`
            : 'Your next payment date will appear when Oxygen confirms your schedule.'}
        </Text>
      </Pressable>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {error}
        </Text>
      )}
      <OxygenActionFooter>
        <OxygenAction
          label={
            requestingCode
              ? 'Sending code…'
              : saving
                ? 'Saving signature…'
                : 'Continue'
          }
          disabled={disabled || saving || !usable}
          onPress={onContinue}
        />
      </OxygenActionFooter>
    </View>
  );
}
