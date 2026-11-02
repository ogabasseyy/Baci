# <Plain-English title of the change>

Task: <task-id>
Owner sign-off: required

<!--
How to use this template:
- Copy it to docs/piggyvest-change-summaries/<task-id>.md, using the task id
  from the plan, and put the same id on the Task line above.
- Owner sign-off: keep "required" for tasks that depend on the money-path
  assurance check. Write "not required" only when the task plan says the
  owner does not need to approve the summary.
- Replace every line in angle brackets. Keep the five headings below exactly
  as written and in this order. Every section needs at least one sentence.
- Write for a non-developer owner: plain English only. No code, no SQL, no
  backticks, no names with underscores, no indented blocks and no HTML.
- Stay at or under 450 words. These comments are not counted.
- The money-pr-assurance check validates this file on every push. The rules
  are in docs/runbooks/money-pr-assurance.md.
-->

## What changes

<What the change does, in two to four sentences a customer could follow.>

## Why

<The problem it solves or the plan step it delivers.>

## What could go wrong and how it is prevented

<Each realistic way money could be lost, duplicated or misdirected, and what
stops it. Name the money rule it protects when one applies.>

## How it is tested

<What the automated tests prove, including failure and repeat cases, and any
sandbox evidence.>

## How it stays switched off

<The flag, gate or missing setup that keeps it inactive in production, and
who turns it on.>
