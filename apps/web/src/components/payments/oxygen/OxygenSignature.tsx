'use client';
import {
  type PointerEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { OxygenSignatureControls } from './OxygenSignatureControls';
import { OxygenSignatureReady } from './OxygenSignatureReady';
import { signatureCanvasPoint } from './signature-canvas-point';
export interface OxygenSignatureHandle {
  save: () => Promise<File | undefined>;
}
export function OxygenSignature({
  disabled,
  onChange,
  initialSignature,
  embedded = false,
  saveOnAccept,
}: {
  initialSignature?: File;
  saveOnAccept?: Ref<OxygenSignatureHandle>;
  embedded?: boolean;
  disabled: boolean;
  onChange: (file: File | undefined) => void;
}) {
  const id = useId();
  const restingHeight = embedded ? 220 : 360;
  const canvas = useRef<HTMLCanvasElement>(null);
  const expandedInk = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef<number | null>(null);
  const revision = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'draw' | 'upload'>('draw');
  const [ink, setInk] = useState(false);
  const [saved, setSaved] = useState(Boolean(initialSignature));
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      ++revision.current;
    },
    []
  );
  function reset() {
    ++revision.current;
    drawing.current = null;
    expandedInk.current = null;
    setExpanded(false);
    setInk(false);
    setSaved(false);
    setError('');
    onChange(undefined);
    const element = canvas.current;
    if (element) {
      element.width = 640;
      element.height = restingHeight;
    }
  }
  function inside(event: PointerEvent<HTMLCanvasElement>) {
    const [x, y] = signatureCanvasPoint(event);
    return (
      x >= 0 &&
      y >= 0 &&
      x <= event.currentTarget.width &&
      y <= event.currentTarget.height
    );
  }
  function toggleSize() {
    const element = canvas.current;
    if (!element || disabled || drawing.current !== null) return;
    const copy = document.createElement('canvas');
    copy.width = element.width;
    copy.height = element.height;
    const source = copy.getContext('2d');
    const target = element.getContext('2d');
    if (!source || !target) return;
    source.drawImage(element, 0, 0);
    ++revision.current;
    if (expanded) {
      expandedInk.current = copy;
      element.height = restingHeight;
      // Fit the complete signature without cropping or stretching it.
      target.drawImage(
        copy,
        (640 - restingHeight) / 2,
        0,
        restingHeight,
        restingHeight
      );
    } else {
      element.height = 640;
      target.drawImage(expandedInk.current ?? copy, 0, 0);
      expandedInk.current = null;
    }
    setExpanded(!expanded);
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (
      disabled ||
      drawing.current !== null ||
      event.button !== 0 ||
      !inside(event)
    )
      return;
    const context = event.currentTarget.getContext('2d');
    if (!context) {
      setError('Drawing is unavailable. Use Upload instead.');
      return;
    }
    ++revision.current;
    expandedInk.current = null;
    onChange(undefined);
    setSaved(false);
    setError('');
    drawing.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = signatureCanvasPoint(event);
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
    context.beginPath();
    context.moveTo(x, y);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || drawing.current !== event.pointerId) return;
    if (!inside(event)) {
      drawing.current = null;
      return;
    }
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    context.lineTo(...signatureCanvasPoint(event));
    context.stroke();
    if (!ink) setInk(true);
  }
  function save(): Promise<File | undefined> {
    if (saved) return Promise.resolve(initialSignature);
    const element = expandedInk.current ?? canvas.current;
    if (!element || disabled || !ink || drawing.current !== null)
      return Promise.resolve(undefined);
    const version = revision.current;
    return new Promise((resolve) => {
      const failed = () => {
        setError(
          'Could not save this signature. Please try again or use Upload.'
        );
        resolve(undefined);
      };
      try {
        element.toBlob((blob) => {
          if (version !== revision.current) return resolve(undefined);
          if (!blob || blob.size === 0 || blob.size > 1_572_864)
            return failed();
          const file = new File([blob], 'signature.png', { type: 'image/png' });
          onChange(file);
          setSaved(true);
          resolve(file);
        }, 'image/png');
      } catch {
        failed();
      }
    });
  }
  useImperativeHandle(saveOnAccept, () => ({ save }));
  return (
    <fieldset
      disabled={disabled}
      className={
        embedded
          ? 'min-w-0 border-0 p-0'
          : `rounded-2xl border p-4 ${saved ? 'border-emerald-100 bg-emerald-50/40' : 'border-rose-100 bg-rose-50/30'}`
      }
      aria-label="Signature"
    >
      {!saved && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Your signature</p>
          <div className="flex rounded-lg bg-white p-1">
            {(['draw', 'upload'] as const).map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={mode === method}
                className={`min-h-11 rounded-md px-3 text-sm font-medium ${mode === method ? 'bg-rose-100 text-red-800' : 'text-gray-600'}`}
                onClick={() => {
                  reset();
                  setMode(method);
                }}
              >
                {method === 'draw' ? 'Draw' : 'Upload'}
              </button>
            ))}
          </div>
        </div>
      )}
      {saved ? (
        <OxygenSignatureReady onReset={reset} />
      ) : mode === 'draw' ? (
        <>
          <p id={`${id}-help`} className="mb-2 text-xs text-gray-500">
            Sign below with your finger or mouse. Prefer a file? Choose Upload.
          </p>
          <div className="relative">
            <canvas
              ref={canvas}
              width={640}
              height={restingHeight}
              role="img"
              aria-label="Draw your signature"
              aria-describedby={`${id}-help`}
              className="block h-auto w-full touch-none rounded-xl border border-dashed border-gray-300 bg-white"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={() => {
                drawing.current = null;
              }}
              onPointerCancel={() => {
                drawing.current = null;
              }}
              onLostPointerCapture={() => {
                drawing.current = null;
              }}
            />
            <OxygenSignatureControls
              expanded={expanded}
              showClear={Boolean(saveOnAccept)}
              onClear={reset}
              onToggle={toggleSize}
            />
          </div>
          {!saveOnAccept && (
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                className="min-h-11 px-2 text-sm text-gray-600 underline"
                onClick={reset}
              >
                Clear
              </button>
              {!saveOnAccept && (
                <button
                  type="button"
                  disabled={!ink}
                  className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:bg-gray-200 disabled:text-gray-500"
                  onClick={save}
                >
                  Use signature
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <label className="mt-3 grid gap-2 text-sm text-gray-600">
          Your signature
          <input
            aria-label="Your signature"
            type="file"
            accept="image/png,image/jpeg"
            className="w-full text-xs file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-rose-100 file:px-3 file:font-medium file:text-red-800"
            onChange={(event) => {
              reset();
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              if (
                !['image/png', 'image/jpeg'].includes(file.type) ||
                file.size === 0 ||
                file.size > 1_572_864
              ) {
                setError(
                  'Choose a PNG or JPEG signature image smaller than 1.5 MB.'
                );
                return;
              }
              onChange(file);
              setSaved(true);
            }}
          />
          <span className="text-xs">PNG or JPEG · up to 1.5 MB</span>
        </label>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
