export type Location = 'packing' | 'inventory';

export interface Item {
  id: string;
  name: string;
  checked: boolean;
  count: number;
  categoryId: string | null;
  location: Location;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  isContainer: boolean;
  packed: boolean;
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
  | { type: 'REORDER_CATEGORY'; id: string; targetId: string; position: 'before' | 'after' }
  | { type: 'REORDER_ITEM'; id: string; targetId: string; position: 'before' | 'after' }
  | { type: 'TOGGLE_CONTAINER'; id: string }
  | { type: 'TOGGLE_CONTAINER_PACKED'; id: string }
  | { type: 'CLEAR_CHECKS' }
  | { type: 'SET_ITEM_COUNT'; id: string; count: number }
  | { type: 'SET_TAB'; tab: Location }
  | { type: 'NEW_TRIP' }
  | { type: 'REPLACE_STATE'; state: AppState };
