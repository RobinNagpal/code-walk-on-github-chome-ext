// Small inline icons (24×24 viewBox) so the player needs no icon font.
const paths = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  prev: 'M6 5h2v14H6zM9.5 12L19 5.5v13z',
  next: 'M16 5h2v14h-2zM14.5 12L5 18.5v-13z',
  close: 'M6.4 5L5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z',
  chevron: 'M8.6 7.4L10 6l6 6-6 6-1.4-1.4 4.6-4.6z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={paths[name]} />
    </svg>
  );
}
