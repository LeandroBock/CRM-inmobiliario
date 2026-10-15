import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Legal, { legalPageFromPath } from './pages/Legal';

// /privacidad y /terminos son públicas (las piden TikTok y Meta al registrar las apps): no pasan por el login
const legal = legalPageFromPath(window.location.pathname);

createRoot(document.getElementById('root')!).render(<StrictMode>{legal ? <Legal page={legal} /> : <App />}</StrictMode>);
