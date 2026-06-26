'use client';

import type React from 'react';
import { useState } from 'react';

type ThemeCompareProps = {
  lightSrc: string;
  darkSrc: string;
  alt?: string;
  caption?: string;
};

export function ThemeCompare({
  lightSrc,
  darkSrc,
  alt = 'Stackarr dashboard theme comparison',
  caption
}: ThemeCompareProps) {
  const [position, setPosition] = useState(50);
  const style = { '--theme-compare-position': `${position}%` } as React.CSSProperties;

  return (
    <figure className="themeCompare" style={style}>
      <div className="themeCompareFrame">
        <img className="themeCompareImage" src={lightSrc} alt={`${alt} in light mode`} loading="lazy" />
        <div className="themeCompareDarkPane" aria-hidden="true">
          <img className="themeCompareImage" src={darkSrc} alt="" loading="lazy" />
        </div>
        <span className="themeCompareBadge themeCompareBadgeLight">Light</span>
        <span className="themeCompareBadge themeCompareBadgeDark">Dark</span>
        <span className="themeCompareHandle" aria-hidden="true" />
        <input
          aria-label="Drag to compare Stackarr light and dark mode screenshots"
          className="themeCompareRange"
          max={100}
          min={0}
          onChange={(event) => setPosition(Number(event.target.value))}
          type="range"
          value={position}
        />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
