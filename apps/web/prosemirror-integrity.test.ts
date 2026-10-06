/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { findInstalledRoots } from './security-integrity-find-installed-roots';
import { installedRoot } from './security-integrity-installed-root';
import { loadCjs } from './security-integrity-load-cjs';
import { overrideRoots } from './security-integrity-override-roots';

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

function viewOverrideRoots(): string[] | null {
  return overrideRoots(
    process.env.PROSEMIRROR_VIEW_ROOTS,
    'PROSEMIRROR_VIEW_ROOTS'
  );
}

function candidateRoots(): string[] {
  return viewOverrideRoots() ?? findInstalledRoots('prosemirror-view');
}

// When a view override is active, model/state must come from explicit
// sibling overrides — never from the ambient workspace. An unpacked
// tarball has no node_modules, so resolving from the view root would
// walk past it and silently test a mixed tarball-view/workspace-model
// pair; failing closed keeps the local pre/post comparison honest.
// Exactly one root each: verification unpacks one tarball per package.
function siblingOverrideRoot(envName: string): string {
  const roots = overrideRoots(process.env[envName], envName);
  if (roots === null || roots.length !== 1 || roots[0] === undefined) {
    throw new Error(
      `PROSEMIRROR_VIEW_ROOTS is set but ${envName} does not name exactly one root; refusing to mix an override view with ambient siblings`
    );
  }
  return roots[0];
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

function buildHarness(viewRoot: string) {
  const viewModule = loadCjs<ProseMirrorView>(viewRoot);
  // Model and state resolve from the view's own root, so the Schema
  // and the view's internal model instance cannot diverge when the
  // view carries a nested model copy (which trips the duplicate-model
  // guard and fails the suite for layout reasons). Under the local
  // tarball-override hook the unpacked view has no node_modules, so
  // resolving from the view root would walk past it to ambient
  // workspace siblings; instead the harness fails closed unless
  // explicit sibling overrides name the model/state tarballs. Overrides
  // are refused under CI, where every root is a real install.
  const overridden = viewOverrideRoots() !== null;
  const modelRoot = overridden
    ? siblingOverrideRoot('PROSEMIRROR_MODEL_ROOTS')
    : installedRoot('prosemirror-model', viewRoot);
  const stateRoot = overridden
    ? siblingOverrideRoot('PROSEMIRROR_STATE_ROOTS')
    : installedRoot('prosemirror-state', viewRoot);
  const { Schema } = loadCjs<ProseMirrorModel>(modelRoot);
  const { EditorState } = loadCjs<ProseMirrorState>(stateRoot);
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
  it('finds at least one installed copy to guard', () => {
    expect(candidateRoots().length).toBeGreaterThan(0);
  });

  it.each(
    candidateRoots()
  )('drops pasted slice context with invalid attributes in %s', (root) => {
    const { view, pastedSlice } = buildHarness(root);
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

  it.each(
    candidateRoots()
  )('still pastes slice context with valid attributes in %s', (root) => {
    const { view, pastedSlice } = buildHarness(root);
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

  // The override trio uses real installed roots (not tarballs): the
  // wiring is identical, since buildHarness only sees root paths. Off
  // CI the lone refusal and the trio wiring both run; under CI the
  // refusal of any override is asserted instead, so no case ever
  // unsets CI on a CI runner.
  it('wires the override trio, refusing it under CI', () => {
    const names = [
      'PROSEMIRROR_VIEW_ROOTS',
      'PROSEMIRROR_MODEL_ROOTS',
      'PROSEMIRROR_STATE_ROOTS',
    ] as const;
    const saved = names.map((name) => process.env[name]);
    try {
      const [viewRoot] = findInstalledRoots('prosemirror-view');
      // The view's own siblings: any other copy would trip the
      // duplicate-model guard, which is layout behavior, not wiring.
      const modelRoot = installedRoot('prosemirror-model', viewRoot);
      const stateRoot = installedRoot('prosemirror-state', viewRoot);
      if (process.env.CI) {
        process.env.PROSEMIRROR_VIEW_ROOTS = viewRoot as string;
        process.env.PROSEMIRROR_MODEL_ROOTS = modelRoot;
        process.env.PROSEMIRROR_STATE_ROOTS = stateRoot;
        expect(() => buildHarness(viewRoot as string)).toThrow(
          /refusing to test non-installed copies/
        );
        return;
      }
      process.env.PROSEMIRROR_VIEW_ROOTS = viewRoot as string;
      delete process.env.PROSEMIRROR_MODEL_ROOTS;
      delete process.env.PROSEMIRROR_STATE_ROOTS;
      expect(() => buildHarness(viewRoot as string)).toThrow(
        /refusing to mix an override view with ambient siblings/
      );
      process.env.PROSEMIRROR_MODEL_ROOTS = modelRoot;
      process.env.PROSEMIRROR_STATE_ROOTS = stateRoot;
      const { view, pastedSlice } = buildHarness(viewRoot as string);
      try {
        const pasted = view.pasteHTML(
          sliceHtml(['evilbox', { src: 'javascript:alert(1)' }]),
          PASTE_EVENT
        );
        expect(pasted).toBe(true);
        expect(pastedSlice().content.firstChild?.type.name).toBe('paragraph');
      } finally {
        view.destroy();
      }
    } finally {
      names.forEach((name, index) => {
        const value = saved[index];
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      });
    }
  });
});
