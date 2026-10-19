'use client';

import { X } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';

export function QuizTopicInput({
  disabled,
  onChange,
  topics,
}: {
  disabled?: boolean;
  onChange: (topics: string[]) => void;
  topics: string[];
}) {
  const inputId = useId();
  const [draft, setDraft] = useState('');
  const addDraft = () => {
    const topic = draft.trim();
    if (
      !topic ||
      topics.some((value) => value.toLowerCase() === topic.toLowerCase())
    )
      return;
    onChange([...topics, topic]);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraft();
    } else if (event.key === 'Backspace' && !draft && topics.length > 0) {
      onChange(topics.slice(0, -1));
    }
  };
  return (
    <div className="grid gap-2 md:col-span-2">
      <label className="text-sm font-medium" htmlFor={inputId}>
        Topics
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-md border bg-background p-2 focus-within:border-ring">
        {topics.map((topic) => (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            key={topic}
          >
            {topic}
            <button
              aria-label={`Remove ${topic}`}
              disabled={disabled}
              onClick={() =>
                onChange(topics.filter((value) => value !== topic))
              }
              type="button"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-52 flex-1 bg-transparent px-1 text-sm outline-none focus-visible:outline-none"
          disabled={disabled}
          id={inputId}
          onBlur={addDraft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a topic, then press Enter"
          value={draft}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Add one or more topics. Press Enter or comma after each topic.
      </p>
    </div>
  );
}
