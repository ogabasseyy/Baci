import { Check, ChevronsUpDown } from 'lucide-react';
import type * as React from 'react';
import * as RPNInput from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input, type InputProps } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { limitPhoneInputDigits } from './limit-phone-input-digits';

type PhoneInputProps = Omit<
  React.ComponentProps<'input'>,
  'onChange' | 'value'
> &
  Omit<RPNInput.Props<typeof RPNInput.default>, 'onChange'> & {
    onChange?: (value: RPNInput.Value) => void;
  };

const PhoneInput = ({
  ref,
  className,
  onChange,
  ...props
}: PhoneInputProps & {
  ref?: React.Ref<React.ComponentRef<typeof RPNInput.default>>;
}) => {
  return (
    <RPNInput.default
      ref={ref}
      className={cn(
        'flex items-center bg-gray-50 border border-gray-200 rounded-xl overflow-hidden focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500',
        className
      )}
      flagComponent={FlagComponent}
      countrySelectComponent={CountrySelect}
      inputComponent={InputComponent}
      /**
       * Handles the onChange event.
       *
       * react-phone-number-input might trigger the onChange event as undefined
       * when a valid phone number is not generated.
       *
       * @param value
       */
      onChange={(value) => onChange?.(value as RPNInput.Value)}
      international
      countryCallingCodeEditable={false}
      {...props}
      limitMaxLength
    />
  );
};
PhoneInput.displayName = 'PhoneInput';

const InputComponent = ({ ref, className, onChange, ...props }: InputProps) => {
  return (
    <Input
      className={cn(
        'rounded-none border-0 bg-transparent text-gray-900 focus-visible:ring-0 focus-visible:ring-offset-0',
        className
      )}
      {...props}
      onChange={(event) => {
        event.target.value = limitPhoneInputDigits(event.target.value);
        onChange?.(event);
      }}
      ref={ref}
    />
  );
};
InputComponent.displayName = 'InputComponent';

type CountrySelectOption = { label: string; value: RPNInput.Country };

type CountrySelectProps = {
  disabled?: boolean;
  value: RPNInput.Country;
  onChange: (value: RPNInput.Country) => void;
  options: CountrySelectOption[];
};

const CountrySelect = ({
  disabled,
  value,
  onChange,
  options,
}: CountrySelectProps) => {
  const handleSelect = (country: RPNInput.Country) => {
    onChange(country);
  };

  const selectedCountry = options.find((option) => option.value === value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={'ghost'}
          className={cn(
            'flex gap-1 rounded-none px-3 h-10 bg-transparent text-gray-900 hover:bg-gray-100 border-r border-gray-200'
          )}
          disabled={disabled}
          aria-label={
            selectedCountry
              ? `Change country: ${selectedCountry.label}`
              : 'Select country'
          }
        >
          <FlagComponent country={value} countryName={value} />
          <ChevronsUpDown
            className={cn(
              '-mr-2 h-4 w-4 opacity-50',
              disabled ? 'hidden' : 'opacity-100'
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-2 overflow-visible bg-store-background text-store-background-text border border-store-primary/20 shadow-xl rounded-xl">
        <Command className="bg-transparent text-store-background-text overflow-visible">
          <CommandList>
            <ScrollArea className="h-72">
              <CommandInput
                className="text-store-background-text placeholder:text-store-background-text/60"
                placeholder="Search country..."
                aria-label="Search country"
              />
              <CommandEmpty className="text-store-background-text/70">
                No country found.
              </CommandEmpty>
              <CommandGroup>
                {options
                  .filter((x) => x.value)
                  .map((option) => {
                    const isCurrentSelection = option.value === value;

                    return (
                      <CommandItem
                        className="gap-2 text-store-background-text data-[selected=true]:bg-store-primary data-[selected=true]:text-store-primary-text"
                        key={option.value}
                        onSelect={() => handleSelect(option.value)}
                      >
                        <FlagComponent
                          country={option.value}
                          countryName={option.label}
                        />
                        <span className="flex-1 text-sm">{option.label}</span>
                        {option.value && (
                          <span className="text-store-background-text/55 text-sm">
                            {`+${RPNInput.getCountryCallingCode(option.value)}`}
                          </span>
                        )}
                        <Check
                          className={cn(
                            'ml-auto h-4 w-4',
                            isCurrentSelection ? 'opacity-100' : 'opacity-0'
                          )}
                          aria-hidden="true"
                        />
                        {isCurrentSelection ? (
                          <span className="sr-only">Currently selected</span>
                        ) : null}
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const FlagComponent = ({ country, countryName }: RPNInput.FlagProps) => {
  const Flag = flags[country];

  return (
    <span className="bg-foreground/20 flex h-4 w-6 overflow-hidden rounded-sm">
      {Flag && <Flag title={countryName} />}
    </span>
  );
};
FlagComponent.displayName = 'FlagComponent';

export { PhoneInput };
