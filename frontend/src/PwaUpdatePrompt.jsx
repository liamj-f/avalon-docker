import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Surfaces a dismissible "a new version is available" toast instead of the
 * service worker silently swapping itself in. Reloading mid-game would
 * drop the player's live socket connection and (depending on timing) could
 * hand them back a stale bundle talking a slightly different protocol to a
 * server that's already moved on -- so the reload only happens when they
 * explicitly ask for it, e.g. between games.
 */
export default function PwaUpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError(error) {
      // Not fatal -- the app works fine without an installed service
      // worker, it just won't be installable/offline-shell-cached.
      console.error('[pwa] service worker registration failed', error);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="toast toast-update" role="status">
      <span>A new version is available.</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        Reload
      </button>
      <button type="button" className="toast-dismiss" onClick={() => setNeedRefresh(false)} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
