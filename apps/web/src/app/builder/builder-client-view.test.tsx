import './builder-client.test-support';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupBuilderClientTest,
  resetBuilderClientTest,
} from './builder-client.test-support';
import { BuilderClientView } from './builder-client-view';
import { useBuilderClientController } from './use-builder-client-controller';

function Harness() {
  return <BuilderClientView controller={useBuilderClientController()} />;
}

describe('BuilderClientView', () => {
  beforeEach(resetBuilderClientTest);
  afterEach(cleanupBuilderClientTest);

  it('renders the builder shell after bootstrap', async () => {
    render(<Harness />);
    expect(await screen.findByText('Website Builder')).toBeInTheDocument();
  });
});
