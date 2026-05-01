export type Location = 'packing' | 'inventory';

export interface Item {
  id: string;
  name: string;
  checked: boolean;
  count: number;
  categoryId: string | null;
  /** null = in inventory; non-null = id of the packing list this item belongs to */
  packingListId: string | null;
  /** null = not assigned to a bag; non-null = id of the container category used as a bag */
  bagCategoryId: string | null;
  /** weight in grams; null = not specified */
  weightG: number | null;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  collapsed: boolean;
  isContainer: boolean;
  packed: boolean;
  /** null = standalone top-level bag; non-null = id of parent container in bag view */
  bagCategoryId: string | null;
  /** null = regular inventory category; non-null = packing-list id this bag belongs to (pure bag, hidden from inventory) */
  packingListId: string | null;
  /** weight of the container/bag itself in grams; null = not specified */
  weightG: number | null;
}

export interface PackingList {
  id: string;
  name: string;
}

export interface Inventory {
  id: string;
  name: string;
  categories: Category[];
  items: Item[];
  packingLists: PackingList[];
  activePackingListId: string | null;
}

export interface AppState {
  inventories: Inventory[];
  activeInventoryId: string;
  activeTab: Location;
}

export type Action =
  | { type: 'ADD_ITEM'; name: string; categoryId: string | null; packingListId: string | null }
  | { type: 'DELETE_ITEM'; id: string }
  | { type: 'TOGGLE_CHECK'; id: string }
  | { type: 'MOVE_ITEM'; id: string; packingListId: string | null }
  | { type: 'RENAME_ITEM'; id: string; name: string }
  | { type: 'ADD_CATEGORY'; name: string; parentId: string | null; isContainer?: boolean; packingListId?: string | null }
  | { type: 'DELETE_CATEGORY'; id: string }
  | { type: 'TOGGLE_COLLAPSE'; id: string }
  | { type: 'RENAME_CATEGORY'; id: string; name: string }
  | { type: 'REORDER_CATEGORY'; id: string; targetId: string; position: 'before' | 'after' }
  | { type: 'REORDER_ITEM'; id: string; targetId: string; position: 'before' | 'after' }
  | { type: 'MOVE_CATEGORY'; id: string; packingListId: string | null }
  | { type: 'TOGGLE_CONTAINER'; id: string }
  | { type: 'TOGGLE_CONTAINER_PACKED'; id: string }
  | { type: 'TOGGLE_BAG_PACKED'; id: string }
  | { type: 'SET_ITEM_BAG'; id: string; bagCategoryId: string | null }
  | { type: 'SET_CATEGORY_BAG'; id: string; bagCategoryId: string | null }
  | { type: 'CLEAR_CHECKS' }
  | { type: 'SET_ITEM_COUNT'; id: string; count: number }
  | { type: 'SET_ITEM_WEIGHT'; id: string; weightG: number | null }
  | { type: 'SET_CATEGORY_WEIGHT'; id: string; weightG: number | null }
  | { type: 'SET_TAB'; tab: Location }
  | { type: 'NEW_TRIP' }
  | { type: 'ADD_INVENTORY'; name: string }
  | { type: 'DELETE_INVENTORY'; id: string }
  | { type: 'RENAME_INVENTORY'; id: string; name: string }
  | { type: 'REORDER_INVENTORY'; id: string; targetId: string; position: 'before' | 'after' }
  | { type: 'SELECT_INVENTORY'; id: string }
  | { type: 'ADD_PACKING_LIST'; name: string }
  | { type: 'DELETE_PACKING_LIST'; id: string }
  | { type: 'RENAME_PACKING_LIST'; id: string; name: string }
  | { type: 'SELECT_PACKING_LIST'; id: string }
  | { type: 'IMPORT_STATE'; state: AppState }
  | { type: 'MERGE_STATE'; state: AppState }
  | { type: 'REPLACE_STATE'; state: AppState };
