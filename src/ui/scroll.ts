// Generic vertical-scroll clamping shared by every scrollable panel (rack panel, offers/jobs
// panels) — factored out once a second panel needed the same "how far can this content scroll"
// formula the rack panel already had.
export function maxScrollOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight);
}

export function clampScrollOffset(
  offsetPx: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  return Math.min(Math.max(offsetPx, 0), maxScrollOffset(contentHeight, viewportHeight));
}
