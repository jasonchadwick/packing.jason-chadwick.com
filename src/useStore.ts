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

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function getItemMergeKey(name: string, categoryId: string | null, packingListId: string | null): string {
  return `${normalizeName(name)}::${categoryId ?? 'none'}::${packingListId ?? 'inventory'}`;
}

function getUniqueId(id: string, used: Set<string>): string {
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let candidate = generateId();
  while (used.has(candidate)) candidate = generateId();
  used.add(candidate);
  return candidate;
}

function mergeInventory(existing: Inventory, imported: Inventory): Inventory {
  const mergedPackingLists = [...existing.packingLists];
  const packingListIds = new Set(mergedPackingLists.map(l => l.id));
  const packingListNameToId = new Map<string, string>(
    mergedPackingLists.map(l => [normalizeName(l.name), l.id]),
  );
  const packingListIdMap = new Map<string, string>();

  for (const list of imported.packingLists) {
    const key = normalizeName(list.name);
    const existingId = packingListNameToId.get(key);
    if (existingId) {
      packingListIdMap.set(list.id, existingId);
      continue;
    }
    const id = getUniqueId(list.id, packingListIds);
    mergedPackingLists.push({ ...list, id });
    packingListNameToId.set(key, id);
    packingListIdMap.set(list.id, id);
  }

  const mergedCategories = [...existing.categories];
  const categoryIds = new Set(mergedCategories.map(c => c.id));
  const categoryIdMap = new Map<string, string>();
  const categoryIndexById = new Map<string, number>(
    mergedCategories.map((c, idx) => [c.id, idx]),
  );
  const categoryKeyToId = new Map<string, string>();
  for (const cat of mergedCategories) {
    const key = `${cat.parentId ?? 'root'}::${normalizeName(cat.name)}`;
    if (!categoryKeyToId.has(key)) categoryKeyToId.set(key, cat.id);
  }

  const pending = new Set(imported.categories.map(c => c.id));
  while (pending.size > 0) {
    let progressed = false;
    for (const cat of imported.categories) {
      if (!pending.has(cat.id)) continue;
      const mappedParentId = cat.parentId === null ? null : categoryIdMap.get(cat.parentId);
      if (cat.parentId !== null && mappedParentId === undefined) continue;

      const key = `${mappedParentId ?? 'root'}::${normalizeName(cat.name)}`;
      const existingCatId = categoryKeyToId.get(key);
      if (existingCatId) {
        categoryIdMap.set(cat.id, existingCatId);
        const idx = categoryIndexById.get(existingCatId);
        if (idx !== undefined) {
          const current = mergedCategories[idx];
          mergedCategories[idx] = {
            ...current,
            isContainer: current.isContainer || cat.isContainer,
            packed: current.packed || cat.packed,
          };
        }
      } else {
        const id = getUniqueId(cat.id, categoryIds);
        const newCat: Category = { ...cat, id, parentId: mappedParentId ?? null };
        categoryIdMap.set(cat.id, id);
        mergedCategories.push(newCat);
        categoryIndexById.set(id, mergedCategories.length - 1);
        categoryKeyToId.set(key, id);
      }
      pending.delete(cat.id);
      progressed = true;
    }

    if (!progressed) {
      for (const cat of imported.categories) {
        if (!pending.has(cat.id)) continue;
        const key = `root::${normalizeName(cat.name)}`;
        const existingCatId = categoryKeyToId.get(key);
        if (existingCatId) {
          categoryIdMap.set(cat.id, existingCatId);
        } else {
          const id = getUniqueId(cat.id, categoryIds);
          const newCat: Category = { ...cat, id, parentId: null };
          categoryIdMap.set(cat.id, id);
          mergedCategories.push(newCat);
          categoryIndexById.set(id, mergedCategories.length - 1);
          categoryKeyToId.set(key, id);
        }
        pending.delete(cat.id);
      }
    }
  }

  const mergedItems = [...existing.items];
  const itemIds = new Set(mergedItems.map(i => i.id));
  const existingItemKeys = new Set(
    mergedItems.map(item => getItemMergeKey(item.name, item.categoryId, item.packingListId)),
  );
  for (const item of imported.items) {
    const categoryId = item.categoryId === null ? null : (categoryIdMap.get(item.categoryId) ?? null);
    const packingListId = item.packingListId === null
      ? null
      : (packingListIdMap.get(item.packingListId) ?? null);
    const key = getItemMergeKey(item.name, categoryId, packingListId);
    if (existingItemKeys.has(key)) continue;

    const id = getUniqueId(item.id, itemIds);
    existingItemKeys.add(key);
    mergedItems.push({ ...item, id, categoryId, packingListId });
  }

  const activePackingListId = mergedPackingLists.some(l => l.id === existing.activePackingListId)
    ? existing.activePackingListId
    : mergedPackingLists[0]?.id ?? null;

  return {
    ...existing,
    packingLists: mergedPackingLists,
    categories: mergedCategories,
    items: mergedItems,
    activePackingListId,
  };
}

function mergeState(current: AppState, imported: AppState): AppState {
  if (!Array.isArray(imported.inventories) || imported.inventories.length === 0) return current;

  const mergedInventories = [...current.inventories];
  const inventoryIds = new Set(mergedInventories.map(inv => inv.id));
  const inventoryNameToIndex = new Map<string, number>();
  for (const [idx, inv] of mergedInventories.entries()) {
    const key = normalizeName(inv.name);
    if (!inventoryNameToIndex.has(key)) inventoryNameToIndex.set(key, idx);
  }

  for (const importedInv of imported.inventories) {
    const key = normalizeName(importedInv.name);
    const existingIndex = inventoryNameToIndex.get(key);
    if (existingIndex !== undefined) {
      mergedInventories[existingIndex] = mergeInventory(mergedInventories[existingIndex], importedInv);
      continue;
    }

    const id = getUniqueId(importedInv.id, inventoryIds);
    const activePackingListId = importedInv.packingLists.some(l => l.id === importedInv.activePackingListId)
      ? importedInv.activePackingListId
      : importedInv.packingLists[0]?.id ?? null;
    mergedInventories.push({ ...importedInv, id, activePackingListId });
    inventoryNameToIndex.set(key, mergedInventories.length - 1);
  }

  const activeInventoryId = mergedInventories.some(inv => inv.id === current.activeInventoryId)
    ? current.activeInventoryId
    : mergedInventories[0].id;
  return { ...current, inventories: mergedInventories, activeInventoryId };
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
    case 'REORDER_INVENTORY': {
      const inventories = [...state.inventories];
      const fromIdx = inventories.findIndex(inv => inv.id === action.id);
      if (fromIdx === -1) return state;
      const [removed] = inventories.splice(fromIdx, 1);
      let toIdx = inventories.findIndex(inv => inv.id === action.targetId);
      if (toIdx === -1) return state;
      if (action.position === 'after') toIdx += 1;
      inventories.splice(toIdx, 0, removed);
      return { ...state, inventories };
    }
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
    case 'IMPORT_STATE': {
      const imported = action.state;
      if (!Array.isArray(imported.inventories) || imported.inventories.length === 0) return state;
      const activeInventoryId = imported.inventories.some(inv => inv.id === imported.activeInventoryId)
        ? imported.activeInventoryId
      : imported.inventories[0].id;
      const activeTab = imported.activeTab === 'inventory' ? 'inventory' : 'packing';
      return { ...imported, activeInventoryId, activeTab };
    }
    case 'MERGE_STATE':
      return mergeState(state, action.state);
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
