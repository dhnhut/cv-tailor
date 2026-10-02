import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from '../src/App';

test('renders the app heading', () => {
  render(<App config={{ environment: 'dev' }} />);
  expect(screen.getByRole('heading', { level: 1, name: 'CV Tailor' })).toBeInstanceOf(
    HTMLHeadingElement,
  );
});

test('shows the environment outside prod', () => {
  render(<App config={{ environment: 'dev' }} />);
  expect(screen.getByText('dev')).toBeInstanceOf(HTMLParagraphElement);
});

test('hides the environment in prod', () => {
  render(<App config={{ environment: 'prod' }} />);
  expect(screen.queryByText('prod')).toBeNull();
});
