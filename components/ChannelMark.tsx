/**
 * THE PLATFORM'S OWN MARK, NOT A COLOURED SQUARE.
 *
 * Every channel in the interface was a rounded rectangle filled with `--ch-linkedin` or `--ch-x`,
 * which is legible only if you already know the convention — and reads as placeholder art, because
 * that is what it is. The real marks cost two inline paths and remove the guessing.
 *
 * Inline SVG rather than an icon package: two glyphs do not justify a dependency in a repository
 * whose rule is that nothing gets installed that cannot be explained, and a remote sprite would not
 * survive the Artifact CSP or an offline reviewer.
 *
 * The brand colours stay on the *mark* and nowhere else, which is Sprout Social's published rule and
 * the reason `--ch-*` exists as a separate token family from the semantic go/attend/stop set: a
 * platform colour identifies a platform and must never be borrowed to mean a state.
 */

/** Re-exported so the marks and their names stay one import for a component that renders both. The
 *  map itself lives in `lib/types.ts`, beside the `Channel` union — see the note there. */
export { CHANNEL_LABEL } from '@/lib/types';
import { CHANNEL_LABEL } from '@/lib/types';

export function ChannelMark({
  channel,
  size = 16,
  withLabel = false,
}: {
  channel: 'linkedin' | 'x';
  size?: number;
  /** Pairs the mark with its name. Colour alone cannot carry identity for a colour-blind reader,
   *  and several surfaces rendered the dot with no text beside it at all. */
  withLabel?: boolean;
}) {
  const mark =
    channel === 'linkedin' ? (
      <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={CHANNEL_LABEL[channel]}>
        <rect width="24" height="24" rx="4" fill="var(--ch-linkedin)" />
        <path
          fill="#fff"
          d="M7.1 9.3H4.6V19h2.5V9.3zM5.85 5A1.45 1.45 0 105.9 7.9 1.45 1.45 0 005.85 5zM19.4 13.5c0-2.4-1.28-3.52-3-3.52-1.38 0-2 .76-2.34 1.3V9.3h-2.5c.03.7 0 9.7 0 9.7h2.5v-5.42c0-.22.02-.44.08-.6.18-.44.58-.9 1.26-.9.9 0 1.25.68 1.25 1.67V19h2.5v-5.5z"
        />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={CHANNEL_LABEL[channel]}>
        <rect width="24" height="24" rx="4" fill="var(--ch-x)" />
        <path
          fill="#fff"
          d="M16.5 5.5h2.1l-4.6 5.25L19.4 18.5h-4.2l-3.3-4.3-3.77 4.3H6l4.92-5.62L5.8 5.5h4.3l3 3.95L16.5 5.5zm-.74 11.75h1.16L9.3 6.68H8.05l7.71 10.57z"
        />
      </svg>
    );

  if (!withLabel) return mark;
  return (
    <span className="ch-pair">
      {mark}
      {CHANNEL_LABEL[channel]}
    </span>
  );
}
