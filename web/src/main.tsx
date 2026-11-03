import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { audio } from './lib/audio';

// Audio may only start after a user gesture; the first tap anywhere unlocks it.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
