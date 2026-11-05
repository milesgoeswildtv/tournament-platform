import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { audio } from './lib/audio';
import { music } from './lib/music';

// iOS Safari requires a user gesture. Start the music pipeline first, then unlock SFX.
window.addEventListener('pointerdown', () => {
  music.unlock();
  audio.unlock();
}, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
