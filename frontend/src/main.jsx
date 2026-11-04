import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { isConfigured } from './supabase';
import { ToastProvider } from './ui.jsx';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles.css';

// A render crash would otherwise leave a blank page.
class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="hero">
        <div className="card stack">
          <h2>Something went wrong 😕</h2>
          <p className="muted small">Reloading usually fixes it. Your data is safe.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <ErrorBoundary>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ErrorBoundary>
    ) : (
      <div className="hero">
        <div className="card">
          <h1>Hardgainer</h1>
          <p className="muted">Coming soon. The app is being set up.</p>
        </div>
      </div>
    )}
  </StrictMode>,
);
