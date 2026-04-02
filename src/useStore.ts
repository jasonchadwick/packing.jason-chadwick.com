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
    case 'CLEAR_CHECKS':
      return {
        ...state,
        items: state.items.map(i => ({ ...i, checked: false })),
      };
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'NEW_TRIP':
      return {
        ...state,
        items: state.items.map(i =>
          i.location === 'packing' ? { ...i, location: 'inventory', checked: false } : i
        ),
      };
    default:
      return state;
  }
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
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
