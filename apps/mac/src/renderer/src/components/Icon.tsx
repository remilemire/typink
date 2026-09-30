// A tiny line-icon set (16×16, currentColor).

const paths = {
  sidebar: 'M2.5 3.5h11v9h-11zM6 3.5v9',
  plus: 'M8 3.5v9M3.5 8h9',
  folderPlus: 'M2 4.5h4l1.2 1.5H14v6.5H2zM8 7.5v3.5M6.25 9.25h3.5',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3l3.2 3.2',
  chevron: 'M4.5 6l3.5 3.5L11.5 6',
  more: '',
  ipad: 'M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM7.5 12h1',
  pencil: 'M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3',
  export: 'M8 10V2.5M5 5.5l3-3 3 3M3 9.5v3.5h10V9.5',
  editor: 'M3 4h10M3 7h10M3 10h6M3 13h8',
  split: 'M2.5 3h11v10h-11zM8 3v10',
  preview: 'M4 2h6l3 3v9H4zM10 2v3h3M6 8h5M6 10.5h5',
  blank: 'M4 2.5h8v11H4z',
  lined: 'M4 2.5h8v11H4zM5.5 6h5M5.5 8.5h5M5.5 11h5',
  grid: 'M4 2.5h8v11H4zM4 6.25h8M4 10h8M6.7 2.5v11M9.3 2.5v11',
  dotted: 'M4 2.5h8v11H4z',
  image: 'M2.5 3.5h11v9h-11zM2.5 10l3-3 3 3 2-2 3 3M10.5 6.2h.01',
  check: 'M3.5 8.5l3 3 6-7',
  close: 'M4 4l8 8M12 4l-8 8',
  warning: 'M8 2.5l6 11H2zM8 6.5v3.5M8 12h.01',
  gear: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1',
  note: 'M4 2h6l3 3v9H4zM10 2v3h3',
  folder: 'M2 4.5h4l1.2 1.5H14v6.5H2z',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9',
  reveal: 'M2 4.5h4l1.2 1.5H14v6.5H2zM9.5 9.5l2 2M11.5 9.5v2h-2',
} as const;

// Dots are drawn as zero-length round-capped segments with a heavier stroke.
const dots: Partial<Record<keyof typeof paths, string>> = {
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  dotted: 'M6 6h.01M8 6h.01M10 6h.01M6 8.5h.01M8 8.5h.01M10 8.5h.01M6 11h.01M8 11h.01M10 11h.01',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {paths[name] && (
        <path d={paths[name]} stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {dots[name] && <path d={dots[name]} stroke="currentColor" strokeWidth={name === 'more' ? 2.4 : 1.7} strokeLinecap="round" />}
    </svg>
  );
}
