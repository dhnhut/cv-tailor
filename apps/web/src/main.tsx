import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadConfig } from './config';
import { StartupError } from './StartupError';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

// Settings come first: everything after this (sign-in, API calls) needs them.
const content = await loadConfig().then(
  (config) => <App config={config} />,
  (error: unknown) => {
    console.error(error);
    return <StartupError />;
  },
);

createRoot(root).render(<StrictMode>{content}</StrictMode>);
