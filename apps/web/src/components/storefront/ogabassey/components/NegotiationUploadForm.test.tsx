import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NegotiationUploadForm } from './NegotiationUploadForm';

function renderForm() {
  return render(
    <NegotiationUploadForm
      email=""
      emailInputId="email-input"
      onBack={vi.fn()}
      onEmailChange={vi.fn()}
      onFileChange={vi.fn()}
      onLinkChange={vi.fn()}
      onPhoneChange={vi.fn()}
      onSubmit={vi.fn()}
      phone=""
      phoneInputId="phone-input"
      uploadFile={null}
      uploadFileInputId="file-input"
      uploadLink=""
      uploadLinkInputId="link-input"
    />
  );
}

describe('NegotiationUploadForm', () => {
  it('renders the contact fields and disables native validation', () => {
    renderForm();

    const form = screen
      .getByRole('button', { name: 'Send for Review' })
      .closest('form');
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute('novalidate');
    expect(screen.getByLabelText('Email Address (Optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone / WhatsApp (Optional)')).toBeInTheDocument();
  });

  it('forwards file and contact changes', () => {
    const onEmailChange = vi.fn();
    const onFileChange = vi.fn();
    const onPhoneChange = vi.fn();
    const file = new File(['proof'], 'proof.png', { type: 'image/png' });

    render(
      <NegotiationUploadForm
        email=""
        emailInputId="email-input"
        onBack={vi.fn()}
        onEmailChange={onEmailChange}
        onFileChange={onFileChange}
        onLinkChange={vi.fn()}
        onPhoneChange={onPhoneChange}
        onSubmit={vi.fn()}
        phone=""
        phoneInputId="phone-input"
        uploadFile={null}
        uploadFileInputId="file-input"
        uploadLink=""
        uploadLinkInputId="link-input"
      />
    );

    fireEvent.change(screen.getByLabelText('Email Address (Optional)'), {
      target: { value: 'buyer@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Phone / WhatsApp (Optional)'), {
      target: { value: '0803 123 4567' },
    });
    fireEvent.change(screen.getByLabelText('Upload proof'), {
      target: { files: [file] },
    });

    expect(onEmailChange).toHaveBeenCalledWith('buyer@example.com');
    expect(onPhoneChange).toHaveBeenCalledWith('0803 123 4567');
    expect(onFileChange).toHaveBeenCalledWith(file);
  });
});
