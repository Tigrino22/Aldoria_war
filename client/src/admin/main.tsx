import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureApi } from '../api';
import Dashboard from './Dashboard';
import '../styles.css';
import '../mobile.css';

// Le tableau de bord garde sa propre session : se connecter ici ne change pas le monde où l'on joue dans le jeu.
configureApi({ tokenKey: 'aldoria.admin.token' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
