import type { ReactNode } from "react";

const glyphs = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10H3z" />
      <path d="M9 20v-7h6v7" />
    </>
  ),
  farm: (
    <>
      <path d="m3 10 9-7 9 7v10H3z" />
      <path d="M7 20v-7h10v7M3 10h18" />
    </>
  ),
  fish: (
    <>
      <path d="M3 12c3-4 6-6 10-6 4 0 7 2 9 6-2 4-5 6-9 6-4 0-7-2-10-6Z" />
      <path d="m3 12-2-4v8l2-4M16 11h.01" />
    </>
  ),
  chicken: (
    <>
      <path d="M5 12c0-3 2-5 5-5h3l2-2 2 2-1 2c2 1 3 3 3 5 0 3-3 5-7 5H9c-3 0-4-2-4-4Z" />
      <path d="M9 19v3m5-3v3m3-12h2" />
    </>
  ),
  crop: (
    <>
      <path d="M20 4c-8 0-14 3-14 11 0 3 2 5 5 5 8 0 11-8 9-16Z" />
      <path d="M4 21c3-5 7-8 12-11" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18" />
    </>
  ),
  package: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10" />
    </>
  ),
  recycle: (
    <>
      <path d="m8 5 2-3h4l2 3m-8 0H5L2 10l2 3h4m8-8h3l3 5-2 3h-4m-9 0 2 3-2 3H8l-3-4m11-5-2 3m-1 6h-3l-2-3" />
      <path d="m8 5 2 2m6-2-2 2m2 8-2-1m-7 3 2-1" />
    </>
  ),
  harvest: (
    <>
      <path d="M12 22V11M12 15C7 15 4 12 4 7c5 0 8 3 8 8Zm0-3c0-5 3-8 8-8 0 5-3 8-8 8Z" />
    </>
  ),
  cart: (
    <>
      <path d="M2 4h2l3 13h12l3-9H6" />
      <circle cx="9" cy="21" r="1" />
      <circle cx="18" cy="21" r="1" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="15" rx="2" />
      <path d="M3 10h18M6 6V4h12m-1 11h2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V9m5 11V4m5 16v-7m5 7V7" />
      <path d="M2 21h20" />
    </>
  ),
  units: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10" />
    </>
  ),
  cycle: (
    <>
      <path d="M20 11a8 8 0 0 0-14-5L4 8m0-5v5h5M4 13a8 8 0 0 0 14 5l2-2m0 5v-5h-5" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </>
  ),
  activity: (
    <>
      <path d="M2 12h4l3-7 5 14 3-7h5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof glyphs;

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  );
}
