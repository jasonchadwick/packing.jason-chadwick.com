import { useState, useRef, useEffect, useCallback, createContext, useContext, useMemo } from 'react';
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
  cancelPush,
} from './syncClient';
import { PasscodeModal } from './PasscodeModal';

// ── Drag & Drop ───────────────────────────────────────────────────────────────

interface DragCtx {
  dragging: { id: string; type: 'category' | 'item' } | null;
  dropTarget: { id: string; position: 'before' | 'after' } | null;
  startDrag: (id: string, type: 'category' | 'item') => void;
  endDrag: () => void;
  onDragOver: (e: React.DragEvent, id: string, type: 'category' | 'item') => void;
  onDrop: (e: React.DragEvent, id: string, type: 'category' | 'item') => void;
}

const DragContext = createContext<DragCtx | null>(null);

function DragProvider({
  children,
  categories,
  items,
  dispatch,
}: {
  children: React.ReactNode;
  categories: Category[];
  items: Item[];
  dispatch: React.Dispatch<Action>;
}) {
  const [dragging, setDragging] = useState<DragCtx['dragging']>(null);
  const [dropTarget, setDropTarget] = useState<DragCtx['dropTarget']>(null);

  // Refs keep callbacks free of stale closures without causing re-renders
  const draggingRef = useRef(dragging);
  const dropTargetRef = useRef(dropTarget);
  const categoriesRef = useRef(categories);
  const itemsRef = useRef(items);
  useEffect(() => { draggingRef.current = dragging; }, [dragging]);
  useEffect(() => { dropTargetRef.current = dropTarget; }, [dropTarget]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const startDrag = useCallback((id: string, type: 'category' | 'item') => {
    setDragging({ id, type });
    setDropTarget(null);
  }, []);

  const endDrag = useCallback(() => {
    setDragging(null);
    setDropTarget(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, targetId: string, type: 'category' | 'item') => {
    const cur = draggingRef.current;
    if (!cur || cur.id === targetId || cur.type !== type) return;

    if (type === 'category') {
      const draggedCat = categoriesRef.current.find(c => c.id === cur.id);
      const targetCat = categoriesRef.current.find(c => c.id === targetId);
      if (!draggedCat || !targetCat || draggedCat.parentId !== targetCat.parentId) return;
    } else {
      const draggedItem = itemsRef.current.find(i => i.id === cur.id);
      const targetItem = itemsRef.current.find(i => i.id === targetId);
      if (
        !draggedItem || !targetItem ||
        draggedItem.categoryId !== targetItem.categoryId ||
        draggedItem.location !== targetItem.location
      ) return;
    }

    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (dropTargetRef.current?.id !== targetId || dropTargetRef.current?.position !== position) {
      setDropTarget({ id: targetId, position });
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetId: string, type: 'category' | 'item') => {
    e.preventDefault();
    e.stopPropagation();
    const cur = draggingRef.current;
    const dt = dropTargetRef.current;
    setDragging(null);
    setDropTarget(null);

    if (!cur || cur.type !== type || cur.id === targetId) return;

    const position = dt?.position ?? 'after';
    if (type === 'category') {
      dispatch({ type: 'REORDER_CATEGORY', id: cur.id, targetId, position });
    } else {
      dispatch({ type: 'REORDER_ITEM', id: cur.id, targetId, position });
    }
  }, [dispatch]);

  const ctx = useMemo(
    () => ({ dragging, dropTarget, startDrag, endDrag, onDragOver, onDrop }),
    [dragging, dropTarget, startDrag, endDrag, onDragOver, onDrop],
  );

  return <DragContext.Provider value={ctx}>{children}</DragContext.Provider>;
}

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

function hasPackingContent(
  categories: Category[],
  items: Item[],
  catId: string,
): boolean {
  const cat = categories.find(c => c.id === catId);
  if (cat?.isContainer) return true;
  if (items.some(i => i.categoryId === catId && i.location === 'packing')) return true;
  return categories
    .filter(c => c.parentId === catId)
    .some(c => hasPackingContent(categories, items, c.id));
}

function CategoryTree({
  category,
  allCategories,
  items,
  depth,
  viewLocation,
  dispatch,
}: CategoryTreeProps) {
  const dragCtx = useContext(DragContext)!;
  const blockRef = useRef<HTMLDivElement>(null);
  const isDragHandleActive = useRef(false);

  const children = allCategories.filter(c => c.parentId === category.id);
  const catItems = items.filter(
    i => i.categoryId === category.id && i.location === viewLocation,
  );
  const subtreeCount = getSubtreeItemCount(allCategories, items, category.id, viewLocation);

  if (viewLocation === 'packing' && !hasPackingContent(allCategories, items, category.id)) {
    return null;
  }

  const isDragging = dragCtx.dragging?.id === category.id && dragCtx.dragging.type === 'category';
  const dropPos = dragCtx.dropTarget?.id === category.id ? dragCtx.dropTarget.position : null;

  return (
    <div
      ref={blockRef}
      className={`category-block${isDragging ? ' is-dragging' : ''}${dropPos ? ` drop-${dropPos}` : ''}`}
      style={{ '--depth': depth } as React.CSSProperties}
      onDragOver={e => dragCtx.onDragOver(e, category.id, 'category')}
      onDrop={e => dragCtx.onDrop(e, category.id, 'category')}
    >
      <div className="category-header">
        <span
          className="drag-handle"
          draggable
          onMouseDown={() => { isDragHandleActive.current = true; }}
          onDragStart={e => {
            if (!isDragHandleActive.current) { e.preventDefault(); return; }
            isDragHandleActive.current = false;
            e.stopPropagation();
            if (blockRef.current) e.dataTransfer.setDragImage(blockRef.current, 0, 0);
            e.dataTransfer.effectAllowed = 'move';
            dragCtx.startDrag(category.id, 'category');
          }}
          onDragEnd={() => { isDragHandleActive.current = false; dragCtx.endDrag(); }}
          title="Drag to reorder"
        >
          ⠿
        </span>
        <button
          className="btn-icon collapse-btn"
          onClick={() => dispatch({ type: 'TOGGLE_COLLAPSE', id: category.id })}
          aria-label={category.collapsed ? 'Expand' : 'Collapse'}
        >
          {category.collapsed ? '▶' : '▼'}
        </button>
        {viewLocation === 'packing' && category.isContainer && (
          <input
            type="checkbox"
            className="container-packed-checkbox"
            checked={category.packed}
            onChange={() => dispatch({ type: 'TOGGLE_CONTAINER_PACKED', id: category.id })}
            title="Mark container as packed"
          />
        )}
        <InlineEdit
          value={category.name}
          onSave={name => dispatch({ type: 'RENAME_CATEGORY', id: category.id, name })}
          className={`category-name${viewLocation === 'packing' && category.isContainer && category.packed ? ' packed' : ''}`}
        />
        {viewLocation === 'inventory' && subtreeCount > 0 && (
          <span className="badge">{subtreeCount}</span>
        )}
        <button
          className={`btn-icon container-toggle${category.isContainer ? ' active' : ''}`}
          onClick={() => dispatch({ type: 'TOGGLE_CONTAINER', id: category.id })}
          aria-label={category.isContainer ? 'Remove container status' : 'Mark as container'}
          title={category.isContainer ? 'Remove container status' : 'Mark as container (bag, box, etc.)'}
        >
          📦
        </button>
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
  const dragCtx = useContext(DragContext)!;
  const rowRef = useRef<HTMLDivElement>(null);
  const isDragHandleActive = useRef(false);

  const isDragging = dragCtx.dragging?.id === item.id && dragCtx.dragging.type === 'item';
  const dropPos = dragCtx.dropTarget?.id === item.id ? dragCtx.dropTarget.position : null;

  return (
    <div
      ref={rowRef}
      className={`item-row${item.checked ? ' checked' : ''}${isDragging ? ' is-dragging' : ''}${dropPos ? ` drop-${dropPos}` : ''}`}
      onDragOver={e => dragCtx.onDragOver(e, item.id, 'item')}
      onDrop={e => dragCtx.onDrop(e, item.id, 'item')}
    >
      <span
        className="drag-handle"
        draggable
        onMouseDown={() => { isDragHandleActive.current = true; }}
        onDragStart={e => {
          if (!isDragHandleActive.current) { e.preventDefault(); return; }
          isDragHandleActive.current = false;
          e.stopPropagation();
          if (rowRef.current) e.dataTransfer.setDragImage(rowRef.current, 0, 0);
          e.dataTransfer.effectAllowed = 'move';
          dragCtx.startDrag(item.id, 'item');
        }}
        onDragEnd={() => { isDragHandleActive.current = false; dragCtx.endDrag(); }}
        title="Drag to reorder"
      >
        ⠿
      </span>
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
    <DragProvider categories={categories} items={items} dispatch={dispatch}>
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
    </DragProvider>
  );
}

// ── InventoryView ─────────────────────────────────────────────────────────────

function InventoryView({ categories, items, dispatch }: ViewProps) {
  const rootCategories = categories.filter(c => c.parentId === null);
  const uncategorized = items.filter(
    i => i.location === 'inventory' && i.categoryId === null,
  );

  return (
    <DragProvider categories={categories} items={items} dispatch={dispatch}>
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
    </DragProvider>
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
          // Cancel any push that was speculatively scheduled before the remote
          // state arrived (e.g. an empty-state push triggered by the listId
          // change), then replace local state with the authoritative remote copy.
          cancelPush();
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
