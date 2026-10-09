import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { IS_NATIVE } from './config';
import { initNative } from './native';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

initNative();

// Le service worker ne sert qu'à la version web (l'application embarque déjà ses fichiers).
if ('serviceWorker' in navigator && import.meta.env.PROD && !IS_NATIVE) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
