import { CheckCircle2, Upload } from 'lucide-react';
import type { ChangeEvent, FormEvent } from 'react';

interface NegotiationUploadFormProps {
  email: string;
  emailInputId: string;
  onBack: () => void;
  onEmailChange: (email: string) => void;
  onFileChange: (file: File | null) => void;
  onLinkChange: (link: string) => void;
  onPhoneChange: (phone: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  phone: string;
  phoneInputId: string;
  uploadFile: File | null;
  uploadFileInputId: string;
  uploadLink: string;
  uploadLinkInputId: string;
}

export function NegotiationUploadForm({
  email,
  emailInputId,
  onBack,
  onEmailChange,
  onFileChange,
  onLinkChange,
  onPhoneChange,
  onSubmit,
  phone,
  phoneInputId,
  uploadFile,
  uploadFileInputId,
  uploadLink,
  uploadLinkInputId,
}: NegotiationUploadFormProps) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileChange(event.target.files?.[0] ?? null);
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="space-y-4 animate-in fade-in slide-in-from-bottom-2"
    >
      <div className="bg-[var(--store-primary)]/5 border border-[var(--store-primary)]/20 rounded-xl p-4">
        <p className="text-sm text-[hsl(var(--card-foreground))] font-medium mb-2">
          📸 Saw it cheaper elsewhere?
        </p>
        <p className="text-xs text-[var(--store-primary)]">
          Upload proof (screenshot, photo) and we&apos;ll try to match or beat
          that price!
        </p>
      </div>

      <div>
        <label
          htmlFor={uploadFileInputId}
          className="block text-sm font-medium text-[hsl(var(--card-foreground))] mb-2"
        >
          Upload Proof
        </label>
        <div className="relative">
          <input
            id={uploadFileInputId}
            type="file"
            accept="image/*"
            aria-label="Upload proof"
            onChange={handleFileChange}
            className="w-full px-4 py-3 border border-[hsl(var(--border))] rounded-xl focus:ring-2 focus:ring-[var(--store-primary)] focus:border-[var(--store-primary)] outline-none transition-all text-sm text-[hsl(var(--card-foreground))] file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[hsl(var(--muted))] file:text-[hsl(var(--card-foreground))] hover:file:bg-[var(--store-primary)]/10"
          />
        </div>
        {uploadFile ? (
          <p className="text-xs text-[var(--store-primary)] mt-2 flex items-center gap-1">
            <CheckCircle2 size={12} />
            {uploadFile.name}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor={uploadLinkInputId}
          className="block text-sm font-medium text-[hsl(var(--card-foreground))] mb-2"
        >
          Link (Optional)
        </label>
        <input
          id={uploadLinkInputId}
          type="url"
          value={uploadLink}
          onChange={(event) => onLinkChange(event.target.value)}
          placeholder="https://example.com/product"
          className="w-full bg-[hsl(var(--card))] px-4 py-3 border border-[hsl(var(--border))] rounded-xl focus:ring-2 focus:ring-[var(--store-primary)] focus:border-[var(--store-primary)] outline-none transition-all text-sm text-[hsl(var(--card-foreground))]"
        />
      </div>

      <div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-3">
          Provide an email address or Phone / WhatsApp number so we can send
          the merchant&apos;s decision.
        </p>
        <label
          htmlFor={emailInputId}
          className="block text-sm font-medium text-[hsl(var(--card-foreground))] mb-2"
        >
          Email Address (Optional)
        </label>
        <input
          id={emailInputId}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="you@example.com"
          className="w-full bg-[hsl(var(--card))] px-4 py-3 border border-[hsl(var(--border))] rounded-xl focus:ring-2 focus:ring-[var(--store-primary)] focus:border-[var(--store-primary)] outline-none transition-all text-sm text-[hsl(var(--card-foreground))]"
        />
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
          We can email you when the merchant accepts or rejects the offer.
        </p>
      </div>

      <div>
        <label
          htmlFor={phoneInputId}
          className="block text-sm font-medium text-[hsl(var(--card-foreground))] mb-2"
        >
          Phone / WhatsApp (Optional)
        </label>
        <input
          id={phoneInputId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          placeholder="e.g. 0803 123 4567"
          className="w-full bg-[hsl(var(--card))] px-4 py-3 border border-[hsl(var(--border))] rounded-xl focus:ring-2 focus:ring-[var(--store-primary)] focus:border-[var(--store-primary)] outline-none transition-all text-sm text-[hsl(var(--card-foreground))]"
        />
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
          So the merchant can reach you about this offer.
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 bg-[hsl(var(--muted))] text-[hsl(var(--card-foreground))] font-bold py-3 rounded-xl hover:bg-[var(--store-primary)]/10 transition-colors"
        >
          Back
        </button>
        <button
          type="submit"
          className="flex-1 bg-[var(--store-primary)] hover:bg-[var(--store-primary)]/90 text-[var(--store-primary-text)] font-bold py-3 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2"
        >
          <Upload size={18} />
          Send for Review
        </button>
      </div>
    </form>
  );
}
