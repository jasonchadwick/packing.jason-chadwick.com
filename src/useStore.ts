import { useReducer, useEffect } from 'react';
import type { AppState, Action, Item, Category } from './types';

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

const defaultState: AppState = {
  items: [],
  categories: [],
  activeTab: 'packing',
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const item: Item = {
        id: generateId(),
        name: action.name.trim(),
        checked: false,
        categoryId: action.categoryId,
        location: action.location,
      };
      return { ...state, items: [...state.items, item] };
    }
    case 'DELETE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case 'TOGGLE_CHECK':
      return {
        ...state,
        items: state.items.map(i =>
          i.id === action.id ? { ...i, checked: !i.checked } : i
        ),
      };
    case 'MOVE_ITEM':
      return {
        ...state,
        items: state.items.map(i =>
          i.id === action.id ? { ...i, location: action.to, checked: false } : i
        ),
      };
    case 'RENAME_ITEM':
      return {
        ...state,
        items: state.items.map(i =>
          i.id === action.id ? { ...i, name: action.name.trim() } : i
        ),
      };
    case 'ADD_CATEGORY': {
      const category: Category = {
        id: generateId(),
        name: action.name.trim(),
        parentId: action.parentId,
        collapsed: false,
        isContainer: false,
        packed: false,
      };
      return { ...state, categories: [...state.categories, category] };
    }
    case 'DELETE_CATEGORY': {
      const toDelete = getSubtreeIds(state.categories, action.id);
      return {
        ...state,
        categories: state.categories.filter(c => !toDelete.includes(c.id)),
        items: state.items.map(i =>
          i.categoryId !== null && toDelete.includes(i.categoryId)
            ? { ...i, categoryId: null }
            : i
        ),
      };
    }
    case 'TOGGLE_COLLAPSE':
      return {
        ...state,
        categories: state.categories.map(c =>
          c.id === action.id ? { ...c, collapsed: !c.collapsed } : c
        ),
      };
    case 'RENAME_CATEGORY':
      return {
        ...state,
        categories: state.categories.map(c =>
          c.id === action.id ? { ...c, name: action.name.trim() } : c
        ),
      };
    case 'REORDER_CATEGORY': {
      const cats = [...state.categories];
      const fromIdx = cats.findIndex(c => c.id === action.id);
      if (fromIdx === -1) return state;
      const [removed] = cats.splice(fromIdx, 1);
      let toIdx = cats.findIndex(c => c.id === action.targetId);
      if (toIdx === -1) return state;
      if (action.position === 'after') toIdx += 1;
      cats.splice(toIdx, 0, removed);
      return { ...state, categories: cats };
    }
    case 'REORDER_ITEM': {
      const items = [...state.items];
      const fromIdx = items.findIndex(i => i.id === action.id);
      if (fromIdx === -1) return state;
      const [removed] = items.splice(fromIdx, 1);
      let toIdx = items.findIndex(i => i.id === action.targetId);
      if (toIdx === -1) return state;
      if (action.position === 'after') toIdx += 1;
      items.splice(toIdx, 0, removed);
      return { ...state, items };
    }
    case 'TOGGLE_CONTAINER':
      return {
        ...state,
        categories: state.categories.map(c =>
          c.id === action.id ? { ...c, isContainer: !c.isContainer, packed: false } : c
        ),
      };
    case 'TOGGLE_CONTAINER_PACKED':
      return {
        ...state,
        categories: state.categories.map(c =>
          c.id === action.id ? { ...c, packed: !c.packed } : c
        ),
      };
    case 'CLEAR_CHECKS':
      return {
        ...state,
        items: state.items.map(i => ({ ...i, checked: false })),
        categories: state.categories.map(c => ({ ...c, packed: false })),
      };
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'NEW_TRIP':
      return {
        ...state,
        items: state.items.map(i =>
          i.location === 'packing' ? { ...i, location: 'inventory', checked: false } : i
        ),
        categories: state.categories.map(c => ({ ...c, packed: false })),
      };
    case 'REPLACE_STATE':
      // Preserve local UI tab selection; replace all data from remote
      return { ...action.state, activeTab: state.activeTab };
    default:
      return state;
  }
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      // Migrate: add defaults for fields added after initial release
      type LegacyCat = Omit<Category, 'isContainer' | 'packed'> & Partial<Pick<Category, 'isContainer' | 'packed'>>;
      return {
        ...parsed,
        categories: (parsed.categories as LegacyCat[]).map(c => ({
          isContainer: false,
          packed: false,
          ...c,
        })),
      };
    }
  } catch { /* ignore */ }
  return defaultState;
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
