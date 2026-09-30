// App entry point: mounts <App /> (src/App.tsx) into #root, wrapped in the Auth0 login/session provider.
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Auth0Provider makes useAuth0() (login state, tokens, user info) available everywhere below,
        including in App.tsx and AdminPanel.tsx's authFetch helper */}
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: 'openid profile email',
      }}
    >
      <App />
    </Auth0Provider>
  </StrictMode>,
);
