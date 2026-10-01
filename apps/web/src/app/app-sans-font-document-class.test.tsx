import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppSansFontDocumentClass } from './app-sans-font-document-class';

describe('AppSansFontDocumentClass', () => {
  afterEach(() => {
    cleanup();
    document.body.className = '';
  });

  it('copies Inter onto document.body so portalled UI can inherit the app font', () => {
    const { unmount } = render(
      <AppSansFontDocumentClass className="font-sans-inter font-sans" />
    );

    expect(document.body).toHaveClass('font-sans-inter', 'font-sans');

    unmount();

    expect(document.body).not.toHaveClass('font-sans-inter');
    expect(document.body).not.toHaveClass('font-sans');
  });
});
