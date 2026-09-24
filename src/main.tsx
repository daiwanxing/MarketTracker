import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/theme.css';
import App from './App.tsx';

/**
 * Match Vite `base`. `import.meta.env.BASE_URL` keeps the trailing slash
 * (`/MarketTracker/` on GitHub Pages, `/` in local dev). React Router wants
 * no trailing slash.
 */
function routerBasename(baseUrl: string): string {
  if (!baseUrl || baseUrl === '/' || baseUrl === './') return '/';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
