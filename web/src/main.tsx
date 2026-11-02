import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/inter';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import { LangProvider } from './i18n';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsProvider } from './site/SiteData';
import './styles/base.css';
import './styles/site.css';
import './styles/portal.css';
import './styles/layout.css';

// After a new version is published, an open tab may ask for a page file that no longer exists. Reload once to pick up the new version.
window.addEventListener('vite:preloadError', () => {
  try { if (sessionStorage.getItem('reloaded-for-update')) return; sessionStorage.setItem('reloaded-for-update', '1'); } catch { /* ignore */ }
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <LangProvider>
          <SettingsProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </SettingsProvider>
        </LangProvider>
      </BrowserRouter>
    </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
