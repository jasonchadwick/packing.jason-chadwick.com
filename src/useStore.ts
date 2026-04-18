import { useReducer, useEffect } from 'react';
import type { AppState, Action, Item, Category, Inventory, PackingList } from './types';
import { migrateState } from './migrate';
import type { RawState } from './migrate';

const STORAGE_KEY = 'packing-list-v1';

function generateId(): string {
  return crypto.randomUUID();
}

function getSubtreeIds(categories: Category[], rootId: string): string[] {
  const result: string[] = [rootId];
  for (const cat of categories) {
    if (cat.parentId === rootId) {
      result.push(...getSubtreeIds(categories, cat.id));
    }
  }
  return result;
}

function updateActiveInventory(
  state: AppState,
  updater: (inv: Inventory) => Inventory,
): AppState {
  return {
    ...state,
    inventories: state.inventories.map(inv =>
      inv.id === state.activeInventoryId ? updater(inv) : inv,
    ),
  };
}

function getActiveInventory(state: AppState): Inventory | undefined {
  return state.inventories.find(inv => inv.id === state.activeInventoryId);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const item: Item = {
        id: generateId(),
        name: action.name.trim(),
        checked: false,
        count: 1,
        categoryId: action.categoryId,
        packingListId: action.packingListId,
      };
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: [...inv.items, item],
      }));
    }
    case 'DELETE_ITEM':
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.filter(i => i.id !== action.id),
      }));
    case 'TOGGLE_CHECK':
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.map(i =>
          i.id === action.id ? { ...i, checked: !i.checked } : i,
        ),
      }));
    case 'MOVE_ITEM':
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.map(i =>
          i.id === action.id ? { ...i, packingListId: action.packingListId, checked: false } : i,
        ),
      }));
    case 'RENAME_ITEM':
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.map(i =>
          i.id === action.id ? { ...i, name: action.name.trim() } : i,
        ),
      }));
    case 'ADD_CATEGORY': {
      const category: Category = {
        id: generateId(),
        name: action.name.trim(),
        parentId: action.parentId,
        collapsed: false,
        isContainer: false,
        packed: false,
      };
      return updateActiveInventory(state, inv => ({
        ...inv,
        categories: [...inv.categories, category],
      }));
    }
    case 'DELETE_CATEGORY': {
      return updateActiveInventory(state, inv => {
        const toDelete = getSubtreeIds(inv.categories, action.id);
        return {
          ...inv,
          categories: inv.categories.filter(c => !toDelete.includes(c.id)),
          items: inv.items.map(i =>
            i.categoryId !== null && toDelete.includes(i.categoryId)
              ? { ...i, categoryId: null }
              : i,
          ),
        };
      });
    }
    case 'TOGGLE_COLLAPSE':
      return updateActiveInventory(state, inv => ({
        ...inv,
        categories: inv.categories.map(c =>
          c.id === action.id ? { ...c, collapsed: !c.collapsed } : c,
        ),
      }));
    case 'RENAME_CATEGORY':
      return updateActiveInventory(state, inv => ({
        ...inv,
        categories: inv.categories.map(c =>
          c.id === action.id ? { ...c, name: action.name.trim() } : c,
        ),
      }));
    case 'REORDER_CATEGORY': {
      return updateActiveInventory(state, inv => {
        const cats = [...inv.categories];
        const fromIdx = cats.findIndex(c => c.id === action.id);
        if (fromIdx === -1) return inv;
        const [removed] = cats.splice(fromIdx, 1);
        let toIdx = cats.findIndex(c => c.id === action.targetId);
        if (toIdx === -1) return inv;
        if (action.position === 'after') toIdx += 1;
        cats.splice(toIdx, 0, removed);
        return { ...inv, categories: cats };
      });
    }
    case 'REORDER_ITEM': {
      return updateActiveInventory(state, inv => {
        const items = [...inv.items];
        const fromIdx = items.findIndex(i => i.id === action.id);
        if (fromIdx === -1) return inv;
        const [removed] = items.splice(fromIdx, 1);
        let toIdx = items.findIndex(i => i.id === action.targetId);
        if (toIdx === -1) return inv;
        if (action.position === 'after') toIdx += 1;
        items.splice(toIdx, 0, removed);
        return { ...inv, items };
      });
    }
    case 'MOVE_CATEGORY': {
      return updateActiveInventory(state, inv => {
        const subtreeCatIds = new Set(getSubtreeIds(inv.categories, action.id));
        return {
          ...inv,
          items: inv.items.map(i =>
            i.categoryId !== null && subtreeCatIds.has(i.categoryId)
              ? { ...i, packingListId: action.packingListId, checked: false }
              : i,
          ),
        };
      });
    }
    case 'TOGGLE_CONTAINER':
      return updateActiveInventory(state, inv => ({
        ...inv,
        categories: inv.categories.map(c =>
          c.id === action.id ? { ...c, isContainer: !c.isContainer, packed: false } : c,
        ),
      }));
    case 'TOGGLE_CONTAINER_PACKED': {
      const activeInv = getActiveInventory(state);
      if (!activeInv) return state;
      const listId = activeInv.activePackingListId;
      const cat = activeInv.categories.find(c => c.id === action.id);
      if (!cat) return state;
      const newPacked = !cat.packed;
      const subtreeCatIds = new Set(getSubtreeIds(activeInv.categories, action.id));
      return updateActiveInventory(state, inv => ({
        ...inv,
        categories: inv.categories.map(c =>
          c.id === action.id ? { ...c, packed: newPacked } : c,
        ),
        items: inv.items.map(i =>
          i.categoryId !== null &&
          subtreeCatIds.has(i.categoryId) &&
          i.packingListId === listId
            ? { ...i, checked: newPacked }
            : i,
        ),
      }));
    }
    case 'SET_ITEM_COUNT':
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.map(i =>
          i.id === action.id
            ? { ...i, count: Number.isFinite(action.count) ? Math.max(1, action.count) : 1 }
            : i,
        ),
      }));
    case 'CLEAR_CHECKS': {
      const activeInv = getActiveInventory(state);
      if (!activeInv) return state;
      const listId = activeInv.activePackingListId;
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.map(i =>
          i.packingListId === listId ? { ...i, checked: false } : i,
        ),
        categories: inv.categories.map(c => ({ ...c, packed: false })),
      }));
    }
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'NEW_TRIP': {
      const activeInv = getActiveInventory(state);
      if (!activeInv) return state;
      const listId = activeInv.activePackingListId;
      return updateActiveInventory(state, inv => ({
        ...inv,
        items: inv.items.map(i =>
          i.packingListId === listId ? { ...i, packingListId: null, checked: false } : i,
        ),
        categories: inv.categories.map(c => ({ ...c, packed: false })),
      }));
    }
    case 'ADD_INVENTORY': {
      const packingList: PackingList = { id: generateId(), name: 'Packing List' };
      const inventory: Inventory = {
        id: generateId(),
        name: action.name.trim(),
        categories: [],
        items: [],
        packingLists: [packingList],
        activePackingListId: packingList.id,
      };
      return {
        ...state,
        inventories: [...state.inventories, inventory],
        activeInventoryId: inventory.id,
      };
    }
    case 'DELETE_INVENTORY': {
      if (state.inventories.length <= 1) return state;
      const newInventories = state.inventories.filter(inv => inv.id !== action.id);
      const newActiveId =
        action.id === state.activeInventoryId
          ? newInventories[0].id
          : state.activeInventoryId;
      return { ...state, inventories: newInventories, activeInventoryId: newActiveId };
    }
    case 'RENAME_INVENTORY':
      return {
        ...state,
        inventories: state.inventories.map(inv =>
          inv.id === action.id ? { ...inv, name: action.name.trim() } : inv,
        ),
      };
    case 'SELECT_INVENTORY':
      return { ...state, activeInventoryId: action.id };
    case 'ADD_PACKING_LIST': {
      const packingList: PackingList = { id: generateId(), name: action.name.trim() };
      return updateActiveInventory(state, inv => ({
        ...inv,
        packingLists: [...inv.packingLists, packingList],
        activePackingListId: packingList.id,
      }));
    }
    case 'DELETE_PACKING_LIST': {
      const activeInv = getActiveInventory(state);
      if (!activeInv || activeInv.packingLists.length <= 1) return state;
      return updateActiveInventory(state, inv => {
        const newLists = inv.packingLists.filter(l => l.id !== action.id);
        const newActiveId =
          action.id === inv.activePackingListId ? newLists[0].id : inv.activePackingListId;
        return {
          ...inv,
          packingLists: newLists,
          activePackingListId: newActiveId,
          items: inv.items.map(i =>
            i.packingListId === action.id ? { ...i, packingListId: null, checked: false } : i,
          ),
        };
      });
    }
    case 'RENAME_PACKING_LIST':
      return updateActiveInventory(state, inv => ({
        ...inv,
        packingLists: inv.packingLists.map(l =>
          l.id === action.id ? { ...l, name: action.name.trim() } : l,
        ),
      }));
    case 'SELECT_PACKING_LIST':
      return updateActiveInventory(state, inv => ({
        ...inv,
        activePackingListId: action.id,
      }));
    case 'IMPORT_STATE':
      return action.state;
    case 'REPLACE_STATE': {
      const newState = action.state;
      const preservedInvId = newState.inventories.some(inv => inv.id === state.activeInventoryId)
        ? state.activeInventoryId
        : (newState.inventories[0]?.id ?? newState.activeInventoryId);
      return { ...newState, activeTab: state.activeTab, activeInventoryId: preservedInvId };
    }
    default:
      return state;
  }
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RawState;
      return migrateState(parsed);
    }
  } catch { /* ignore */ }

  // Fresh default state
  const packingList: PackingList = { id: generateId(), name: 'Packing List' };
  const inventory: Inventory = {
    id: generateId(),
    name: 'My Stuff',
    categories: [],
    items: [],
    packingLists: [packingList],
    activePackingListId: packingList.id,
  };
  return {
    inventories: [inventory],
    activeInventoryId: inventory.id,
    activeTab: 'packing',
  };
}

export function useStore() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }, [state]);
  return { state, dispatch };
}
