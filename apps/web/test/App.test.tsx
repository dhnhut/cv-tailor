import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from '../src/App';

test('renders the app heading', () => {
  render(<App />);

  const heading = screen.getByRole('heading', { level: 1, name: 'CV Tailor' });

  expect(heading).toBeInstanceOf(HTMLHeadingElement);
});
