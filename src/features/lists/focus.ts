export type Direction = 'up' | 'down';

/** The id of an item's "Mută mai sus" / "Mută mai jos" button: a screen puts focus back on it after the move. */
export const moveButtonId = (itemId: string, direction: Direction): string =>
  `move-${direction}-${itemId}`;
