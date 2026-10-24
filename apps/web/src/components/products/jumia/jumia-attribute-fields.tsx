'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  attributeUnavailableReason,
  type JumiaDraftAttribute,
  type JumiaDraftValue,
  type JumiaDraftValues,
  validateAttributeValue,
} from './jumia-attribute-values';

interface Props {
  attributes: JumiaDraftAttribute[];
  values: JumiaDraftValues;
  onChange: (code: string, value: JumiaDraftValue | undefined) => void;
}

export function JumiaAttributeFields({ attributes, values, onChange }: Props) {
  const prefix = useId();
  return (
    <div className="grid gap-4">
      {attributes.map((attribute) => {
        const key = String(attribute.code);
        const id = `${prefix}-${key}`;
        const value = values[key];
        const unavailable = attributeUnavailableReason(attribute);
        const problem = validateAttributeValue(attribute, value);
        const common = {
          id,
          required: attribute.mandatory,
          'aria-describedby': `${id}-help`,
          'aria-invalid': problem !== null,
        };
        const options =
          attribute.options?.filter((option) => option.status === 'ACTIVE') ??
          [];
        const textValue =
          typeof value === 'string' || typeof value === 'number' ? value : '';
        return (
          <div key={key} className="grid gap-1">
            <Label htmlFor={id}>
              {attribute.name}
              {attribute.mandatory ? ' (required)' : ' (optional)'}
            </Label>
            {unavailable ? null : attribute.type === 1 ? (
              <Textarea
                {...common}
                value={textValue}
                onChange={(event) => onChange(key, event.target.value)}
              />
            ) : attribute.type === 6 ? (
              <select
                {...common}
                className="rounded-md border bg-background p-2"
                value={typeof value === 'boolean' ? String(value) : ''}
                onChange={(event) =>
                  onChange(
                    key,
                    event.target.value === ''
                      ? undefined
                      : event.target.value === 'true'
                  )
                }
              >
                <option value="">Choose Yes or No</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : attribute.type === 3 ? (
              <select
                {...common}
                multiple
                className="rounded-md border bg-background p-2"
                value={Array.isArray(value) ? value.map(String) : []}
                onChange={(event) =>
                  onChange(
                    key,
                    Array.from(event.target.selectedOptions, (option) =>
                      Number(option.value)
                    )
                  )
                }
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : attribute.type === 4 ? (
              <select
                {...common}
                className="rounded-md border bg-background p-2"
                value={typeof value === 'number' ? value : ''}
                onChange={(event) =>
                  onChange(
                    key,
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value)
                  )
                }
              >
                <option value="">Choose an option</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                {...common}
                type={
                  [2, 8].includes(attribute.type)
                    ? 'number'
                    : attribute.type === 5
                      ? 'date'
                      : 'text'
                }
                step={attribute.type === 2 ? 1 : 'any'}
                value={textValue}
                placeholder={
                  attribute.type === 7
                    ? (attribute.validations?.dateFormat ?? undefined)
                    : undefined
                }
                onChange={(event) =>
                  onChange(
                    key,
                    [2, 8].includes(attribute.type)
                      ? event.target.value === ''
                        ? undefined
                        : event.target.valueAsNumber
                      : event.target.value
                  )
                }
              />
            )}
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
              {unavailable ?? problem ?? attribute.description}
              {!unavailable && [5, 7].includes(attribute.type)
                ? ` Required format: ${attribute.validations?.dateFormat}. No timezone is inferred.`
                : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
}
