'use client';
import { CheckCircle2, Maximize2, Minimize2, Pencil } from 'lucide-react';
import { type PointerEvent, useEffect, useId, useRef, useState } from 'react';

/** Signature bytes stay in this form until the customer submits their code. */
export function OxygenSignature({
  disabled,
  onChange,
  initialSignature,
  embedded = false,
}: {
  initialSignature?: File;
  embedded?: boolean;
  disabled: boolean;
  onChange: (file: File | undefined) => void;
}) {
  const id = useId();
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
      element.height = 360;
    }
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) * element.width) / rect.width,
      ((event.clientY - rect.top) * element.height) / rect.height,
    ] as const;
  }
  function inside(event: PointerEvent<HTMLCanvasElement>) {
    const [x, y] = point(event);
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
      element.height = 360;
      // Fit the complete signature without cropping or stretching it.
      target.drawImage(copy, 140, 0, 360, 360);
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
    const [x, y] = point(event);
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
    context.lineTo(...point(event));
    context.stroke();
    if (!ink) setInk(true);
  }
  function save() {
    const element = expandedInk.current ?? canvas.current;
    if (!element || disabled || !ink || drawing.current !== null) return;
    const version = revision.current;
    try {
      element.toBlob((blob) => {
        if (version !== revision.current) return;
        if (!blob || blob.size === 0 || blob.size > 1_572_864) {
          setError(
            'Could not save this signature. Please try again or use Upload.'
          );
          return;
        }
        onChange(new File([blob], 'signature.png', { type: 'image/png' }));
        setSaved(true);
      }, 'image/png');
    } catch {
      setError(
        'Could not save this signature. Please try again or use Upload.'
      );
    }
  }
  return (
    <fieldset
      disabled={disabled}
      className={
        embedded && saved
          ? 'min-w-0 border-0 p-0'
          : `rounded-2xl border p-4 ${saved ? 'border-emerald-100 bg-emerald-50/40' : 'border-rose-100 bg-rose-50/30'}`
      }
      aria-label="Signature"
    >
      {!saved && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Your signature</p>
          {!saved && (
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
          )}
        </div>
      )}
      {saved ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="size-8 shrink-0 text-emerald-600"
            />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Your signature
              </p>
              <p role="status" className="mt-0.5 text-xs text-emerald-700">
                Signature ready
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Change signature"
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={reset}
          >
            <Pencil aria-hidden="true" className="size-4" />
            Change
          </button>
        </div>
      ) : mode === 'draw' ? (
        <>
          <p id={`${id}-help`} className="mb-2 text-xs text-gray-500">
            Sign below with your finger or mouse. Prefer a file? Choose Upload.
          </p>
          <div className="relative">
            <canvas
              ref={canvas}
              width={640}
              height={360}
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
            <button
              type="button"
              aria-label={
                expanded ? 'Reduce signing area' : 'Expand signing area'
              }
              title={expanded ? 'Reduce signing area' : 'Expand signing area'}
              aria-pressed={expanded}
              className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={toggleSize}
            >
              {expanded ? (
                <Minimize2 aria-hidden="true" className="size-4" />
              ) : (
                <Maximize2 aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              className="min-h-11 px-2 text-sm text-gray-600 underline"
              onClick={reset}
            >
              Clear
            </button>
            <button
              type="button"
              disabled={!ink}
              className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:bg-gray-200 disabled:text-gray-500"
              onClick={save}
            >
              Use signature
            </button>
          </div>
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
