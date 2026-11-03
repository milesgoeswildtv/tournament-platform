/**
 * Icon set: 24px grid, 2px stroke, square caps and mitred joins — drawn like
 * stencilled signage rather than rounded app glyphs.
 */
const PATHS: Record<string, string> = {
  hub: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  join: 'M4 6h12l4 6-4 6H4zM9 9v6',
  sponsor: 'M4 20V4M4 5h13l-3 4 3 4H4',
  library: 'M4 20V4h4v16M10 20V6h4v14M15.5 6.5l3.8-1 3 13.6-3.8 1zM3 20h19',
  ranks: 'M3 20h18M5 20v-6h4v6M10 20V8h4v12M15 20v-9h4v9',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM10.3 2.5h3.4l.5 2.6 1.7 1 2.5-.9 1.7 2.9-2 1.8v2l2 1.8-1.7 2.9-2.5-.9-1.7 1-.5 2.6h-3.4l-.5-2.6-1.7-1-2.5.9-1.7-2.9 2-1.8v-2l-2-1.8 1.7-2.9 2.5.9 1.7-1z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6',
  chat: 'M4 5h16v11H9l-5 4z',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  close: 'M5 5l14 14M19 5 5 19',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v8h14v-8',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  check: 'M4 12l5 5L20 6',
  plus: 'M12 4v16M4 12h16',
  minus: 'M4 12h16',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4M12 14v4M8 21h8M9 18h6',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c.8-3.4 3.4-5 7-5s6.2 1.6 7 5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 15c2 .6 3.4 2.3 4 5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7v.01',
  log: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  exit: 'M10 4H4v16h6M15 8l4 4-4 4M19 12H9',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  telegram: 'M21 4 3 11l6 2 2 6 3-4 5 4z M9 13l8-6',
  discord: 'M6 7h12l3 10-4 1.5-2-3H9l-2 3L3 17zM8.5 10.5v3M7 12h3M15.5 11.5h.01M17 13h.01',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  up: 'M12 20V5M5 11l7-7 7 7',
  down: 'M12 4v15M5 13l7 7 7-7',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  wifi: 'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5v.01',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
