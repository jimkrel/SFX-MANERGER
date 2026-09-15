import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import App from './App';
import { QuickLauncher } from './components/QuickLauncher';
import './styles/index.css';

const isQuickLauncher =
  window.location.search.includes('window=quick-launcher') ||
  window.location.hash.includes('quick-launcher');

if (isQuickLauncher) {
  document.documentElement.classList.add('quick-launcher-mode');
  document.body.classList.add('quick-launcher-mode');
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      {isQuickLauncher ? <QuickLauncher /> : <App />}
    </React.StrictMode>
  );
}
