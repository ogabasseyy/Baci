/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { installedRoot } from './security-integrity-installed-root';
import { loadCjs } from './security-integrity-load-cjs';
import { resolveRoot } from './security-integrity-resolve-root';

// NOTE: model/state/view must all load through the SAME CJS module
// instances: mixing the ESM and CJS builds trips ProseMirror's
// duplicate-model guard ("looks like multiple versions of
// prosemirror-model were loaded").

// Behavioral coverage for CVE-2026-104847: prosemirror-view pasted
// attacker-controlled slice context (`data-pm-slice`) without running
// attribute validators, so a crafted clipboard payload could plant nodes
// with malicious attributes (XSS). Fixed in 1.42.3 ("Run attribute
// validators on attributes provided via slice context in clipboard
// content"): invalid context is now dropped instead of instantiated.
//
// The exploit runs through the public `EditorView.pasteHTML` entry
// point — the same `doPaste → parseFromClipboard` path a real paste
// event takes — never through the dunder test export.

interface PastedSlice {
  content: {
    firstChild: {
      type: { name: string };
      attrs: Record<string, unknown>;
    } | null;
  };
}

interface EditorState {
  apply: (tr: unknown) => EditorState;
}

interface EditorViewInstance {
  pasteHTML: (html: string, event?: unknown) => boolean;
  updateState: (state: unknown) => void;
  destroy: () => void;
}

// jsdom has no ClipboardEvent constructor; pasteHTML only forwards the
// event to the handlePaste prop (unused here), so a stub preserves the
// pasted-content behavior exactly.
const PASTE_EVENT = { type: 'paste' };

interface ProseMirrorView {
  EditorView: new (
    mount: HTMLElement,
    props: {
      state: unknown;
      dispatchTransaction: (tr: unknown) => void;
      handlePaste: (
        view: unknown,
        event: unknown,
        slice: PastedSlice
      ) => boolean;
    }
  ) => EditorViewInstance;
}

function loadView(): ProseMirrorView {
  const root = resolveRoot(
    'prosemirror-view',
    process.env.PROSEMIRROR_VIEW_ROOT,
    'PROSEMIRROR_VIEW_ROOT'
  );
  return loadCjs(root);
}

interface ProseMirrorModel {
  Schema: new (
    spec: unknown
  ) => {
    node: (type: string, attrs: unknown, content?: unknown) => unknown;
  };
}

interface ProseMirrorState {
  EditorState: {
    create: (config: unknown) => EditorState;
  };
}

function buildHarness(viewModule: ProseMirrorView) {
  const { Schema } = loadCjs<ProseMirrorModel>(
    installedRoot('prosemirror-model')
  );
  const { EditorState } = loadCjs<ProseMirrorState>(
    installedRoot('prosemirror-state')
  );
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        group: 'block',
        content: 'inline*',
        toDOM: () => ['p', 0],
        parseDOM: [{ tag: 'p' }],
      },
      text: { group: 'inline' },
      // Stand-in for any node whose attributes reach the DOM: the
      // validator rejects javascript: payloads, mirroring how a real
      // schema constrains URL-typed attributes.
      evilbox: {
        group: 'block',
        content: 'block+',
        attrs: {
          src: {
            default: 'https://default.invalid/',
            validate: (value: unknown) => {
              if (typeof value !== 'string' || /^\s*javascript:/i.test(value)) {
                throw new RangeError('bad src');
              }
            },
          },
        },
        toDOM: () => ['div', 0],
        parseDOM: [{ tag: 'div.evilbox' }],
      },
    },
    marks: {},
  });
  let current = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph')]),
  });
  // What the paste logic produced: the public handlePaste hook
  // receives the parsed slice before selection fitting, exactly where
  // the CVE fix drops invalid context. Returning true marks the paste
  // handled so nothing is dispatched.
  const captured: PastedSlice[] = [];
  const view = new viewModule.EditorView(document.createElement('div'), {
    state: current,
    dispatchTransaction: (tr: unknown) => {
      current = current.apply(tr);
      view.updateState(current);
    },
    handlePaste: (_view: unknown, _event: unknown, slice: PastedSlice) => {
      captured.push(slice);
      return true;
    },
  });
  const pastedSlice = (): PastedSlice => {
    const [slice] = captured.splice(0, captured.length);
    if (slice === undefined) {
      throw new Error('paste produced no slice');
    }
    return slice;
  };
  return { view, pastedSlice };
}

function sliceHtml(context: unknown): string {
  return (
    `<div data-pm-slice="0 0 ${JSON.stringify(context).replace(/"/g, '&quot;')}">` +
    '<p>hi</p></div>'
  );
}

describe('prosemirror-view integrity (CVE-2026-104847)', () => {
  it('drops pasted slice context with invalid attributes', () => {
    const { view, pastedSlice } = buildHarness(loadView());
    try {
      const pasted = view.pasteHTML(
        sliceHtml(['evilbox', { src: 'javascript:alert(1)' }]),
        PASTE_EVENT
      );
      expect(pasted).toBe(true);
      // Fixed: the validator rejects the payload, so the malicious
      // wrapper is dropped and the plain paragraph survives. Pre-fix the
      // slice arrived wrapped in evilbox carrying the javascript: src.
      expect(pastedSlice().content.firstChild?.type.name).toBe('paragraph');
    } finally {
      view.destroy();
    }
  });

  it('still pastes slice context with valid attributes', () => {
    const { view, pastedSlice } = buildHarness(loadView());
    try {
      const pasted = view.pasteHTML(
        sliceHtml(['evilbox', { src: 'https://ok.invalid/' }]),
        PASTE_EVENT
      );
      expect(pasted).toBe(true);
      const firstChild = pastedSlice().content.firstChild;
      expect(firstChild?.type.name).toBe('evilbox');
      expect(firstChild?.attrs).toMatchObject({ src: 'https://ok.invalid/' });
    } finally {
      view.destroy();
    }
  });
});
