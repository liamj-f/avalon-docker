import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'avalon.theme';
const THEME_COLOR = { dark: '#0f1420', light: '#f4ecd8' };

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

// A purely per-browser display preference -- stored in localStorage, never
// sent to the server or synced between players (nothing here touches a
// socket). Defaults to following the OS (prefers-color-scheme, handled in
// styles.css) until this player explicitly flips it, at which point
// data-theme on <html> carries that choice and wins over the OS from then
// on (see styles.css's :root[data-theme='light'] rule and the media
// query's :not([data-theme='dark']) guard). The index.html <head> applies
// any stored choice synchronously before first paint, so there's no flash
// back to the OS default on reload -- this component only needs to react
// to actual clicks, plus keep the theme-color meta tag (browser chrome/PWA
// title bar color) in sync, which that inline script can't reach.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEY));
  const effective = theme || (systemPrefersDark() ? 'dark' : 'light');

  useEffect(() => {
    if (theme) {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(STORAGE_KEY, theme);
    } else {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(STORAGE_KEY);
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[effective]);
  }, [theme, effective]);

  const toggle = () => setTheme(effective === 'dark' ? 'light' : 'dark');

  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-checked={effective === 'dark'}
      onClick={toggle}
      title={`Switch to ${effective === 'dark' ? 'light' : 'dark'} mode (this browser only)`}
    >
      <span aria-hidden="true">☀️</span>
      <span className="theme-toggle-track">
        <span className="theme-toggle-knob" />
      </span>
      <span aria-hidden="true">🌙</span>
    </button>
  );
}
