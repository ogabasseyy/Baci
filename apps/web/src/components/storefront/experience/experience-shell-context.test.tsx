import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { expect, it } from 'vitest';
import { ExperienceShellContext } from './experience-shell-context';

it('supplies no execution authority outside the trusted persistent shell', () => {
  function Native() {
    const c = useContext(ExperienceShellContext);
    return <p>{c ? 'bound' : 'native only'}</p>;
  }
  render(<Native />);
  expect(screen.getByText('native only')).toBeVisible();
});
