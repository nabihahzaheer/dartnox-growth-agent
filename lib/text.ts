/**
 * Small text helpers shared by more than one screen.
 *
 * `firstSentence` existed twice before this file did — once in the approvals queue to trim a post
 * preview, once inside `components/metrics/Tile.tsx` to trim a metric definition — with the same
 * body and two different docblocks explaining the same edge case. A third copy was about to be
 * written for the rebuilt metrics screen, which is the point at which two copies stop being a
 * coincidence.
 *
 * `components/metrics/Tile.tsx` keeps its own copy on purpose: it is reachable only from `/v1/*`,
 * which is the 17 Aug submission preserved verbatim, and the value of leaving that tree untouched
 * is worth more than deleting eight lines from it.
 */

/**
 * The first sentence of a string, or the whole string if it has only one.
 *
 * Splits on a full stop followed by a space, so decimals and percentages inside these strings
 * ("40%.", "0.85") cannot cut one short mid-number.
 */
export function firstSentence(text: string): string {
  const end = text.indexOf('. ');
  return end === -1 ? text : text.slice(0, end + 1);
}
