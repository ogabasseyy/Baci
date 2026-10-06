/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  installedRoot,
  loadCjs,
  resolveRoot,
} from './security-integrity-utils';

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

interface ProseMirrorView {
  EditorView: new (
    mount: HTMLElement,
    props: { state: unknown; dispatchTransaction?: () => void }
  ) => { destroy: () => void };
  __parseFromClipboard: (
    view: unknown,
    text: string,
    html: string | null,
    plainText: boolean,
    context: unknown
  ) => {
    content: {
      firstChild: {
        type: { name: string };
        attrs: Record<string, unknown>;
      } | null;
    };
  };
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
    text: (text: string) => unknown;
  };
}

interface ProseMirrorState {
  EditorState: {
    create: (config: unknown) => {
      selection: { $from: unknown };
    };
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
  const state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph')]),
  });
  const view = new viewModule.EditorView(document.createElement('div'), {
    state,
    dispatchTransaction: () => {},
  });
  return { view, state };
}

function pasteSlice(
  viewModule: ProseMirrorView,
  view: unknown,
  context: unknown,
  selection: unknown
) {
  const html =
    `<div data-pm-slice="0 0 ${JSON.stringify(context).replace(/"/g, '&quot;')}">` +
    '<p>hi</p></div>';
  return viewModule.__parseFromClipboard(view, '', html, false, selection);
}

describe('prosemirror-view integrity (CVE-2026-104847)', () => {
  it('drops slice context with invalid attributes', () => {
    const viewModule = loadView();
    const { view, state } = buildHarness(viewModule);
    try {
      const slice = pasteSlice(
        viewModule,
        view,
        ['evilbox', { src: 'javascript:alert(1)' }],
        state.selection.$from
      );
      // Fixed: the validator rejects the payload, so the malicious
      // wrapper is dropped and the plain paragraph survives. Pre-fix the
      // slice arrived wrapped in evilbox carrying the javascript: src.
      expect(slice.content.firstChild?.type.name).toBe('paragraph');
    } finally {
      view.destroy();
    }
  });

  it('still honors slice context with valid attributes', () => {
    const viewModule = loadView();
    const { view, state } = buildHarness(viewModule);
    try {
      const slice = pasteSlice(
        viewModule,
        view,
        ['evilbox', { src: 'https://ok.invalid/' }],
        state.selection.$from
      );
      expect(slice.content.firstChild?.type.name).toBe('evilbox');
      expect(slice.content.firstChild?.attrs).toMatchObject({
        src: 'https://ok.invalid/',
      });
    } finally {
      view.destroy();
    }
  });
});
