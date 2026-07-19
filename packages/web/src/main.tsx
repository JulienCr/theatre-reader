import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { uiCss } from '@theatre/ui';
import { App } from './App';
import './styles.css';

// Jetons + primitives de @theatre/ui, injectés **avant** styles.css (prepend) :
// la feuille de l'app doit pouvoir surcharger les primitives, jamais l'inverse.
// Ils arrivent en chaîne et non en fichier .css parce que le lecteur mobile
// exporté inline exactement le même CSS (cf. packages/ui/src/index.ts).
const tokens = document.createElement('style');
tokens.id = 'theatre-ui';
tokens.textContent = uiCss;
document.head.prepend(tokens);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
