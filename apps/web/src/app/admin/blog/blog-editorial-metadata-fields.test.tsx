import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { toApiPayload } from './blog-api-payload';
import { BlogEditorFields } from './blog-editor-fields';
import { parseReviewHandoff } from './parse-review-handoff';

vi.mock('@/components/blog/blog-editor', () => ({ BlogEditor: () => null }));

function Harness() {
  const [form, setForm] = useState(
    parseReviewHandoff({
      schema_version: 'baci-blog-review-handoff/v1',
      title: 'Guide',
      content_html: '<p>Guide</p>',
      featured_image: { url: 'https://cdn.example.com/cover.webp' },
      intent: 'comparison',
      intent_source: 'draft_task_type',
      focus_keyword: 'shop comparison',
    })
  );
  return (
    <>
      <BlogEditorFields
        form={form}
        isEditMode={false}
        onFormChange={setForm}
        onContentChange={() => {}}
        onInlineImageUpload={async () => ''}
        onSubmit={() => {}}
        onUploadFeatured={() => {}}
        saving={false}
        uploadingFeatured={false}
      />
      <output aria-label="Save payload">
        {JSON.stringify(toApiPayload(form, { clearEmptyToNull: true }))}
      </output>
    </>
  );
}

it('shows imported metadata and saves reviewer corrections', () => {
  render(<Harness />);
  expect(
    screen.getByRole('combobox', { name: 'Editorial intent' })
  ).toHaveValue('comparison');
  expect(screen.getByRole('textbox', { name: 'Intent source' })).toHaveValue(
    'draft_task_type'
  );
  expect(screen.getByRole('textbox', { name: 'Focus keyword' })).toHaveValue(
    'shop comparison'
  );
  fireEvent.change(screen.getByLabelText('Editorial intent'), {
    target: { value: 'buying-guide' },
  });
  fireEvent.change(screen.getByLabelText('Intent source'), {
    target: { value: 'editorial_review' },
  });
  fireEvent.change(screen.getByLabelText('Focus keyword'), {
    target: { value: 'buying guide' },
  });
  expect(
    JSON.parse(screen.getByLabelText('Save payload').textContent ?? '{}')
  ).toMatchObject({
    intent: 'buying-guide',
    intent_source: 'editorial_review',
    focus_keyword: 'buying guide',
  });
});

it('clears provenance when the editorial intent changes', () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Editorial intent'), {
    target: { value: 'buying-guide' },
  });
  expect(screen.getByRole('textbox', { name: 'Intent source' })).toHaveValue(
    ''
  );
  expect(
    JSON.parse(screen.getByLabelText('Save payload').textContent ?? '{}')
  ).toMatchObject({ intent: 'buying-guide', intent_source: null });
});

it('keeps provenance when the intent selection is unchanged', () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Editorial intent'), {
    target: { value: 'comparison' },
  });
  expect(screen.getByRole('textbox', { name: 'Intent source' })).toHaveValue(
    'draft_task_type'
  );
});

it('lets reviewers clear all imported metadata', () => {
  render(<Harness />);
  for (const label of ['Editorial intent', 'Intent source', 'Focus keyword']) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
  }
  expect(
    JSON.parse(screen.getByLabelText('Save payload').textContent ?? '{}')
  ).toMatchObject({
    intent: null,
    intent_source: null,
    focus_keyword: null,
  });
});
