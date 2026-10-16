// App entry point: fetches Auth0 config from the backend, then mounts <App />.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Buffer } from 'buffer';
import process from 'process';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App.tsx';
import './index.css';

// Polyfills for exceljs, which expects Node's Buffer/process globals in the browser
window.Buffer = window.Buffer || Buffer;
window.process = window.process || process;

async function init() {
  // In dev, Vite env vars are used directly. In production, config comes from the backend.
  const domain = import.meta.env.VITE_AUTH0_DOMAIN;
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

  let auth0Domain = domain;
  let auth0ClientId = clientId;
  let auth0Audience = audience;

  if (!domain || !clientId) {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      auth0Domain = cfg.auth0Domain;
      auth0ClientId = cfg.auth0ClientId;
      auth0Audience = cfg.auth0Audience;
    } catch {
      console.error('Failed to fetch app config from backend');
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Auth0Provider
        domain={auth0Domain}
        clientId={auth0ClientId}
        useRefreshTokens={true}
        cacheLocation="localstorage"
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: auth0Audience,
          scope: 'openid profile email offline_access',
        }}
      >
        <App />
      </Auth0Provider>
    </StrictMode>,
  );
}

init();
