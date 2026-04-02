export type Location = 'packing' | 'inventory';

export interface Item {
  id: string;
  name: string;
  checked: boolean;
  categoryId: string | null;
  location: Location;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
}

export interface AppState {
  items: Item[];
  categories: Category[];
  activeTab: Location;
}

export type Action =
  | { type: 'ADD_ITEM'; name: string; categoryId: string | null; location: Location }
  | { type: 'DELETE_ITEM'; id: string }
  | { type: 'TOGGLE_CHECK'; id: string }
  | { type: 'MOVE_ITEM'; id: string; to: Location }
  | { type: 'RENAME_ITEM'; id: string; name: string }
  | { type: 'ADD_CATEGORY'; name: string; parentId: string | null }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'TOGGLE_COLLAPSE'; id: string }
  | { type: 'RENAME_CATEGORY'; id: string; name: string }
  | { type: 'CLEAR_CHECKS' }
  | { type: 'SET_TAB'; tab: Location }
  | { type: 'NEW_TRIP' };
