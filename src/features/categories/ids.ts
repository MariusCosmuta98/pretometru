/** The ids of a category's buttons: a screen puts focus back on one after the panel it opened closes. */
export const addButtonId = 'add-category';
export const listHeadingId = 'categories-heading';
export const editButtonId = (id: string): string => `edit-category-${id}`;
export const deleteButtonId = (id: string): string => `delete-category-${id}`;
export const moveButtonId = (id: string, direction: 'up' | 'down'): string =>
  `move-${direction}-category-${id}`;
