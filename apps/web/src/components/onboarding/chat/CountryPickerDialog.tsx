'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { WEB_COUNTRIES } from './web-onboarding-chat-helpers';

interface CountryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCountry: (code: string, name: string) => void;
}

export function CountryPickerDialog({
  open,
  onOpenChange,
  onSelectCountry,
}: CountryPickerDialogProps) {
  const [countrySearch, setCountrySearch] = useState('');
  const query = countrySearch.trim().toLowerCase();
  const filteredCountries = query
    ? WEB_COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.code.toLowerCase().includes(query)
      )
    : WEB_COUNTRIES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select your country</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={countrySearch}
            onChange={(event) => setCountrySearch(event.target.value)}
            placeholder="Search countries..."
            aria-label="Search countries"
            className="pl-9"
          />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {filteredCountries.map((country) => (
            <li key={country.code}>
              <button
                type="button"
                onClick={() => {
                  setCountrySearch('');
                  onSelectCountry(country.code, country.name);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span aria-hidden="true">{country.flag}</span>
                <span>{country.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
