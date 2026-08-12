import React from 'react';

/**
 * Purely decorative line-art per quest theme, rendered as an absolutely/
 * fixed-positioned, non-interactive watermark -- never part of the game
 * state, just mood. All shapes use `currentColor` so a single CSS `color`
 * (set per theme in styles.css) drives the whole motif; no external image
 * assets, so nothing to fetch and nothing that can 404.
 *
 * `variant`: 'page' renders behind the entire app while a quest is
 * current; 'modal' renders behind one QuestResultModal, scoped to
 * whichever quest *that* modal is showing (which may not be the current
 * one, when reopening an old result).
 */
export default function QuestThemeArt({ theme, variant }) {
  return (
    <div className={`quest-theme-bg quest-theme-bg-${variant} quest-theme-${theme}`} aria-hidden="true">
      <svg viewBox="0 0 800 800" preserveAspectRatio="xMaxYMax slice">
        {ART[theme]}
      </svg>
    </div>
  );
}

const ART = {
  'round-table': (
    <g fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="400" cy="400" r="260" />
      <circle cx="400" cy="400" r="205" strokeWidth="1.5" opacity="0.6" />
      {[
        [660, 400],
        [584, 584],
        [400, 660],
        [216, 584],
        [140, 400],
        [216, 216],
        [400, 140],
        [584, 216],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="16" fill="currentColor" stroke="none" />
      ))}
    </g>
  ),
  camelot: (
    <g fill="none" stroke="currentColor" strokeWidth="3">
      <line x1="120" y1="580" x2="680" y2="580" />
      <rect x="150" y="320" width="90" height="260" />
      <rect x="160" y="295" width="18" height="25" fill="currentColor" stroke="none" />
      <rect x="195" y="295" width="18" height="25" fill="currentColor" stroke="none" />
      <rect x="355" y="200" width="100" height="380" />
      <polygon points="355,200 405,120 455,200" fill="currentColor" stroke="none" />
      <line x1="405" y1="120" x2="405" y2="80" />
      <polygon points="405,80 445,95 405,110" fill="currentColor" stroke="none" />
      <rect x="565" y="340" width="90" height="240" />
      <rect x="575" y="315" width="18" height="25" fill="currentColor" stroke="none" />
      <rect x="610" y="315" width="18" height="25" fill="currentColor" stroke="none" />
    </g>
  ),
  'holy-grail': (
    <g fill="none" stroke="currentColor" strokeWidth="3">
      <g strokeWidth="2" opacity="0.7">
        <line x1="490" y1="260" x2="610" y2="260" />
        <line x1="464" y1="324" x2="548" y2="408" />
        <line x1="400" y1="350" x2="400" y2="470" />
        <line x1="336" y1="324" x2="252" y2="408" />
        <line x1="310" y1="260" x2="190" y2="260" />
        <line x1="336" y1="196" x2="252" y2="112" />
        <line x1="400" y1="170" x2="400" y2="50" />
        <line x1="464" y1="196" x2="548" y2="112" />
      </g>
      <path d="M310,180 L490,180 L430,320 L370,320 Z" />
      <rect x="385" y="320" width="30" height="140" />
      <ellipse cx="400" cy="475" rx="75" ry="18" />
    </g>
  ),
  camlann: (
    <g fill="none" stroke="currentColor">
      <polyline points="430,120 460,220 390,280 450,360 380,460" strokeWidth="2" opacity="0.5" />
      <line x1="230" y1="600" x2="560" y2="230" strokeWidth="8" />
      <line x1="270" y1="480" x2="330" y2="440" strokeWidth="8" />
      <circle cx="230" cy="600" r="14" fill="currentColor" stroke="none" />
      <line x1="570" y1="600" x2="240" y2="230" strokeWidth="8" />
      <line x1="470" y1="440" x2="530" y2="480" strokeWidth="8" />
      <circle cx="570" cy="600" r="14" fill="currentColor" stroke="none" />
    </g>
  ),
  'isle-of-avalon': (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="560" cy="180" r="80" fill="currentColor" stroke="none" opacity="0.8" />
      <path d="M100,560 Q160,540 220,560 T340,560 T460,560 T580,560 T700,560" opacity="0.7" />
      <path d="M100,610 Q160,590 220,610 T340,610 T460,610 T580,610 T700,610" opacity="0.5" />
      <path d="M100,660 Q160,640 220,660 T340,660 T460,660 T580,660 T700,660" opacity="0.35" />
      <ellipse cx="400" cy="640" rx="150" ry="26" fill="currentColor" stroke="none" opacity="0.5" />
    </g>
  ),
};
