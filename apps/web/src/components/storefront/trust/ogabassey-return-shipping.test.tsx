import {
  OGABASSEY_CHANGE_OF_MIND_BUYBACK,
  OGABASSEY_RETURN_SHIPPING,
} from '@baci/shared';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OgabasseyReturnShipping } from './ogabassey-return-shipping';

it('renders the approved shipping and buyback terms', () => {
  render(<OgabasseyReturnShipping />);
  expect(screen.getByText(OGABASSEY_RETURN_SHIPPING)).toBeVisible();
  expect(screen.getByText(OGABASSEY_CHANGE_OF_MIND_BUYBACK)).toBeVisible();
});
