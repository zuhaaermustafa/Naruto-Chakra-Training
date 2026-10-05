// Assign effects using handedness labels, never the changing array order.
// The tracker can report two hands under the same label (typically when they cross), so keep
// the more confident one per label. The shadow clone seal does not use labels at all.
export function assignHandRoles(hands, swapped = false) {
  const best = label => hands
    .filter(hand => hand.label === label)
    .reduce((top, hand) => (!top || (hand.score ?? 0) > (top.score ?? 0) ? hand : top), null);
  const right = best('Right');
  const left = best('Left');
  return swapped ? { rasengan: left, chidori: right } : { rasengan: right, chidori: left };
}
