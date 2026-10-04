import { render, screen } from '@testing-library/react';
import type { WebConfig } from '@cv-tailor/contracts';
import { expect, test } from 'vitest';
import { App } from '../src/App';
import { DEV_CONFIG } from './fixtures';

const config = (environment: WebConfig['environment']): WebConfig => ({
  ...DEV_CONFIG,
  environment,
});

test('renders the app heading', () => {
  render(<App config={config('dev')} />);
  expect(screen.getByRole('heading', { level: 1, name: 'CV Tailor' })).toBeInstanceOf(
    HTMLHeadingElement,
  );
});

test('shows the environment outside prod', () => {
  render(<App config={config('dev')} />);
  expect(screen.getByText('dev')).toBeInstanceOf(HTMLParagraphElement);
});

test('hides the environment in prod', () => {
  render(<App config={config('prod')} />);
  expect(screen.queryByText('prod')).toBeNull();
});
