import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from './useStore';
import type { Category, Item, Location } from './types';
import type { Action } from './types';
import type { SyncStatus } from './syncClient';
import {
  loadListId,
  isOfflineOnly,
  savePasscode,
  setOfflineOnly,
  fetchRemoteState,
  schedulePush,
} from './syncClient';
import { PasscodeModal } from './PasscodeModal';

// ── InlineEdit ────────────────────────────────────────────────────────────────

interface InlineEditProps {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}

function InlineEdit({ value, onSave, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
    else setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`inline-edit-input ${className ?? ''}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }

  return (
    <span
      className={`inline-edit-text ${className ?? ''}`}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Click to edit"
    >
      {value}
    </span>
  );
}

// ── AddForm ───────────────────────────────────────────────────────────────────

interface AddFormProps {
  placeholder: string;
  onAdd: (name: string) => void;
  className?: string;
}

function AddForm({ placeholder, onAdd, className }: AddFormProps) {
  const [value, setValue] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) { onAdd(trimmed); setValue(''); }
  }

  return (
    <form className={`add-form ${className ?? ''}`} onSubmit={submit}>
      <input
        className="add-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
      />
    </form>
  );
}

// ── CategoryTree ──────────────────────────────────────────────────────────────

interface CategoryTreeProps {
  category: Category;
  allCategories: Category[];
  items: Item[];
  depth: number;
  viewLocation: Location;
  dispatch: React.Dispatch<Action>;
}

function getSubtreeItemCount(
  categories: Category[],
  items: Item[],
  catId: string,
  location: Location,
): number {
  const childIds = categories
    .filter(c => c.parentId === catId)
    .map(c => c.id);
  const direct = items.filter(i => i.categoryId === catId && i.location === location).length;
  const nested = childIds.reduce(
    (sum, id) => sum + getSubtreeItemCount(categories, items, id, location),
    0,
  );
  return direct + nested;
}

function hasPackingItems(
  categories: Category[],
  items: Item[],
  catId: string,
): boolean {
  if (items.some(i => i.categoryId === catId && i.location === 'packing')) return true;
  return categories
    .filter(c => c.parentId === catId)
    .some(c => hasPackingItems(categories, items, c.id));
}

function CategoryTree({
  category,
  allCategories,
  items,
  depth,
  viewLocation,
  dispatch,
}: CategoryTreeProps) {
  const children = allCategories.filter(c => c.parentId === category.id);
  const catItems = items.filter(
    i => i.categoryId === category.id && i.location === viewLocation,
  );
  const subtreeCount = getSubtreeItemCount(allCategories, items, category.id, viewLocation);

  if (viewLocation === 'packing' && !hasPackingItems(allCategories, items, category.id)) {
    return null;
  }

  return (
    <div className="category-block" style={{ '--depth': depth } as React.CSSProperties}>
      <div className="category-header">
        <button
          className="btn-icon collapse-btn"
          onClick={() => dispatch({ type: 'TOGGLE_COLLAPSE', id: category.id })}
          aria-label={category.collapsed ? 'Expand' : 'Collapse'}
        >
          {category.collapsed ? '▶' : '▼'}
        </button>
        <InlineEdit
          value={category.name}
          onSave={name => dispatch({ type: 'RENAME_CATEGORY', id: category.id, name })}
          className="category-name"
        />
        {viewLocation === 'inventory' && subtreeCount > 0 && (
          <span className="badge">{subtreeCount}</span>
        )}
        <button
          className="btn-icon danger"
          onClick={() => {
            if (confirm(`Delete "${category.name}" and all its contents?`)) {
              dispatch({ type: 'DELETE_CATEGORY', id: category.id });
            }
          }}
          aria-label="Delete category"
        >
          ✕
        </button>
      </div>

      {!category.collapsed && (
        <div className="category-body">
          {catItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              viewLocation={viewLocation}
              dispatch={dispatch}
            />
          ))}

          {children.map(child => (
            <CategoryTree
              key={child.id}
              category={child}
              allCategories={allCategories}
              items={items}
              depth={depth + 1}
              viewLocation={viewLocation}
              dispatch={dispatch}
            />
          ))}

          <AddForm
            placeholder="Add item here…"
            onAdd={name =>
              dispatch({ type: 'ADD_ITEM', name, categoryId: category.id, location: viewLocation })
            }
            className="cat-add-item"
          />

          {viewLocation === 'inventory' && (
            <AddForm
              placeholder="Add sub-category…"
              onAdd={name =>
                dispatch({ type: 'ADD_CATEGORY', name, parentId: category.id })
              }
              className="cat-add-sub"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── ItemRow ───────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: Item;
  viewLocation: Location;
  dispatch: React.Dispatch<Action>;
}

function ItemRow({ item, viewLocation, dispatch }: ItemRowProps) {
  return (
    <div className={`item-row ${item.checked ? 'checked' : ''}`}>
      {viewLocation === 'packing' && (
        <input
          type="checkbox"
          className="item-checkbox"
          checked={item.checked}
          onChange={() => dispatch({ type: 'TOGGLE_CHECK', id: item.id })}
        />
      )}
      <InlineEdit
        value={item.name}
        onSave={name => dispatch({ type: 'RENAME_ITEM', id: item.id, name })}
        className="item-name"
      />
      <div className="item-actions">
        {viewLocation === 'packing' ? (
          <button
            className="btn-move"
            onClick={() => dispatch({ type: 'MOVE_ITEM', id: item.id, to: 'inventory' })}
            title="Move to inventory"
          >
            ↩
          </button>
        ) : (
          <button
            className="btn-move pack"
            onClick={() => dispatch({ type: 'MOVE_ITEM', id: item.id, to: 'packing' })}
            title="Add to packing list"
          >
            Pack →
          </button>
        )}
        <button
          className="btn-icon danger"
          onClick={() => dispatch({ type: 'DELETE_ITEM', id: item.id })}
          aria-label="Delete item"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── PackingView ───────────────────────────────────────────────────────────────

interface ViewProps {
  categories: Category[];
  items: Item[];
  dispatch: React.Dispatch<Action>;
}

function PackingView({ categories, items, dispatch }: ViewProps) {
  const rootCategories = categories.filter(c => c.parentId === null);
  const uncategorized = items.filter(
    i => i.location === 'packing' && i.categoryId === null,
  );

  return (
    <div className="view">
      {rootCategories.map(cat => (
        <CategoryTree
          key={cat.id}
          category={cat}
          allCategories={categories}
          items={items}
          depth={0}
          viewLocation="packing"
          dispatch={dispatch}
        />
      ))}

      {uncategorized.length > 0 && (
        <div className="category-block uncategorized" style={{ '--depth': 0 } as React.CSSProperties}>
          <div className="category-header">
            <span className="category-name muted">Uncategorized</span>
          </div>
          <div className="category-body">
            {uncategorized.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                viewLocation="packing"
                dispatch={dispatch}
              />
            ))}
          </div>
        </div>
      )}

      <AddForm
        placeholder="Add item to packing list…"
        onAdd={name =>
          dispatch({ type: 'ADD_ITEM', name, categoryId: null, location: 'packing' })
        }
        className="root-add"
      />
      <AddForm
        placeholder="Add category…"
        onAdd={name => dispatch({ type: 'ADD_CATEGORY', name, parentId: null })}
        className="root-add"
      />
    </div>
  );
}

// ── InventoryView ─────────────────────────────────────────────────────────────

function InventoryView({ categories, items, dispatch }: ViewProps) {
  const rootCategories = categories.filter(c => c.parentId === null);
  const uncategorized = items.filter(
    i => i.location === 'inventory' && i.categoryId === null,
  );

  return (
    <div className="view">
      {rootCategories.map(cat => (
        <CategoryTree
          key={cat.id}
          category={cat}
          allCategories={categories}
          items={items}
          depth={0}
          viewLocation="inventory"
          dispatch={dispatch}
        />
      ))}

      {uncategorized.length > 0 && (
        <div className="category-block uncategorized" style={{ '--depth': 0 } as React.CSSProperties}>
          <div className="category-header">
            <span className="category-name muted">Uncategorized</span>
          </div>
          <div className="category-body">
            {uncategorized.map(item => (
              <ItemRow
                key={item.id}
                item={item}
                viewLocation="inventory"
                dispatch={dispatch}
              />
            ))}
            <AddForm
              placeholder="Add item here…"
              onAdd={name =>
                dispatch({ type: 'ADD_ITEM', name, categoryId: null, location: 'inventory' })
              }
              className="cat-add-item"
            />
          </div>
        </div>
      )}

      <AddForm
        placeholder="Add item to inventory…"
        onAdd={name =>
          dispatch({ type: 'ADD_ITEM', name, categoryId: null, location: 'inventory' })
        }
        className="root-add"
      />
      <AddForm
        placeholder="Add category…"
        onAdd={name => dispatch({ type: 'ADD_CATEGORY', name, parentId: null })}
        className="root-add"
      />
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  onNewTrip: () => void;
  onClearChecks: () => void;
  syncStatus: SyncStatus;
  onSyncClick: () => void;
}

const SYNC_LABELS: Record<SyncStatus, string> = {
  none: 'Enable sync',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline — changes saved locally',
  error: 'Sync error — click to retry',
};

function Header({ onNewTrip, onClearChecks, syncStatus, onSyncClick }: HeaderProps) {
  return (
    <header className="app-header">
      <h1 className="app-title">🎒 Packing</h1>
      <div className="header-actions">
        <button
          className={`btn-sync btn-sync--${syncStatus}`}
          onClick={onSyncClick}
          title={SYNC_LABELS[syncStatus]}
          aria-label={SYNC_LABELS[syncStatus]}
        >
          <span className="sync-icon">{syncStatus === 'syncing' ? '↻' : '☁'}</span>
        </button>
        <button className="btn-secondary" onClick={onClearChecks}>
          Clear Checks
        </button>
        <button className="btn-danger" onClick={onNewTrip}>
          New Trip
        </button>
      </div>
    </header>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

interface TabsProps {
  active: Location;
  onChange: (tab: Location) => void;
}

function Tabs({ active, onChange }: TabsProps) {
  return (
    <nav className="tabs">
      <button
        className={`tab ${active === 'packing' ? 'active' : ''}`}
        onClick={() => onChange('packing')}
      >
        Packing List
      </button>
      <button
        className={`tab ${active === 'inventory' ? 'active' : ''}`}
        onClick={() => onChange('inventory')}
      >
        My Stuff
      </button>
    </nav>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { state, dispatch } = useStore();

  // ── Sync state ──────────────────────────────────────────────────────────────

  const [listId, setListId] = useState<string | null>(() => loadListId());
  const [modalMode, setModalMode] = useState<'setup' | 'change' | null>(
    () => loadListId() === null && !isOfflineOnly() ? 'setup' : null,
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    () => loadListId() !== null ? 'syncing' : 'none',
  );

  // Ref to always have the latest state available inside async callbacks
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Refs to suppress spurious pushes
  const isRemoteLoad = useRef(false);
  const isFirstRender = useRef(true);
  // Track which list ID we've already loaded from remote to avoid duplicate fetches
  const loadedForListId = useRef<string | null>(null);

  // Load from remote whenever a (new) list ID becomes active
  useEffect(() => {
    if (!listId || loadedForListId.current === listId) return;
    loadedForListId.current = listId;
    fetchRemoteState(listId)
      .then(remote => {
        if (remote) {
          // Replace local state with remote; suppress the resulting push
          isRemoteLoad.current = true;
          dispatch({ type: 'REPLACE_STATE', state: remote });
          setSyncStatus('synced');
        } else {
          // New list on remote — bootstrap it with the current local state
          schedulePush(listId, stateRef.current, setSyncStatus);
        }
      })
      .catch(() => setSyncStatus(navigator.onLine ? 'error' : 'offline'));
  }, [listId, dispatch]);

  // Debounced push on every local state change
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!listId) return;
    if (isRemoteLoad.current) { isRemoteLoad.current = false; return; }
    schedulePush(listId, state, setSyncStatus);
  }, [state, listId]);

  // ── Sync handlers ───────────────────────────────────────────────────────────

  const handlePasscodeConfirm = useCallback(async (newPasscode: string) => {
    // savePasscode hashes the input and stores only the hash — never the raw value
    const id = await savePasscode(newPasscode);
    setListId(id);
    setSyncStatus('syncing'); // event handler — not an effect, so this is fine
    setModalMode(null);
    loadedForListId.current = null; // trigger a fresh remote load
  }, []);

  const handleSkip = useCallback(() => {
    setOfflineOnly();
    setModalMode(null);
    setSyncStatus('none');
  }, []);

  const handleSyncClick = useCallback(() => {
    setModalMode(listId ? 'change' : 'setup');
  }, [listId]);

  // ── List handlers ───────────────────────────────────────────────────────────

  const handleNewTrip = useCallback(() => {
    if (confirm('Start a new trip? All packing items will be moved back to inventory.')) {
      dispatch({ type: 'NEW_TRIP' });
    }
  }, [dispatch]);

  const handleClearChecks = useCallback(() => {
    dispatch({ type: 'CLEAR_CHECKS' });
  }, [dispatch]);

  return (
    <div className="app">
      <Header
        onNewTrip={handleNewTrip}
        onClearChecks={handleClearChecks}
        syncStatus={syncStatus}
        onSyncClick={handleSyncClick}
      />
      <Tabs
        active={state.activeTab}
        onChange={tab => dispatch({ type: 'SET_TAB', tab })}
      />
      <main className="app-main">
        {state.activeTab === 'packing' ? (
          <PackingView
            categories={state.categories}
            items={state.items}
            dispatch={dispatch}
          />
        ) : (
          <InventoryView
            categories={state.categories}
            items={state.items}
            dispatch={dispatch}
          />
        )}
      </main>
      {modalMode && (
        <PasscodeModal
          mode={modalMode}
          onConfirm={handlePasscodeConfirm}
          onSkip={modalMode === 'setup' ? handleSkip : undefined}
          onClose={modalMode === 'change' ? () => setModalMode(null) : undefined}
        />
      )}
    </div>
  );
}
