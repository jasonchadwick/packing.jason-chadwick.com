import { useState, useRef, useEffect, useCallback, createContext, useContext, useMemo } from 'react';
import { useStore } from './useStore';
import type { Category, Item, Location, PackingList } from './types';
import type { Action } from './types';
import type { SyncStatus } from './syncClient';
import { migrateState } from './migrate';
import type { RawState } from './migrate';
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
        draggedItem.packingListId !== targetItem.packingListId
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
  activePackingListId: string | null;
  dispatch: React.Dispatch<Action>;
}

function getSubtreeItemCount(
  categories: Category[],
  items: Item[],
  catId: string,
  location: Location,
  activePackingListId?: string | null,
): number {
  const childIds = categories
    .filter(c => c.parentId === catId)
    .map(c => c.id);
  const direct = items.filter(i =>
    i.categoryId === catId &&
    (location === 'packing'
      ? i.packingListId === activePackingListId
      : i.packingListId === null),
  ).length;
  const nested = childIds.reduce(
    (sum, id) => sum + getSubtreeItemCount(categories, items, id, location, activePackingListId),
    0,
  );
  return direct + nested;
}

function hasPackingContent(
  categories: Category[],
  items: Item[],
  catId: string,
  activePackingListId: string | null,
): boolean {
  if (items.some(i => i.categoryId === catId && i.packingListId === activePackingListId)) return true;
  return categories
    .filter(c => c.parentId === catId)
    .some(c => hasPackingContent(categories, items, c.id, activePackingListId));
}

function CategoryTree({
  category,
  allCategories,
  items,
  depth,
  viewLocation,
  activePackingListId,
  dispatch,
}: CategoryTreeProps) {
  const dragCtx = useContext(DragContext)!;
  const blockRef = useRef<HTMLDivElement>(null);
  const isDragHandleActive = useRef(false);

  const children = allCategories.filter(c => c.parentId === category.id);
  const catItems = items.filter(
    i => i.categoryId === category.id &&
      (viewLocation === 'packing'
        ? i.packingListId === activePackingListId
        : true), // inventory: show all items (packed and unpacked) so nothing is hidden
  );
  const subtreeCount = getSubtreeItemCount(
    allCategories, items, category.id, viewLocation, activePackingListId,
  );

  if (viewLocation === 'packing' && !hasPackingContent(allCategories, items, category.id, activePackingListId)) {
    return null;
  }

  const isDragging = dragCtx.dragging?.id === category.id && dragCtx.dragging.type === 'category';
  const dropPos = dragCtx.dropTarget?.id === category.id ? dragCtx.dropTarget.position : null;

  return (
    <div
      ref={blockRef}
      className={`category-block${isDragging ? ' is-dragging' : ''}${dropPos ? ` drop-${dropPos}` : ''}`}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      <div
        className="category-header"
        onDragOver={e => dragCtx.onDragOver(e, category.id, 'category')}
        onDrop={e => dragCtx.onDrop(e, category.id, 'category')}
      >
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
        {viewLocation === 'inventory' && subtreeCount > 0 && (
          <button
            className="btn-move pack"
            onClick={() =>
              dispatch({ type: 'MOVE_CATEGORY', id: category.id, packingListId: activePackingListId })
            }
            title="Add all items to packing list"
          >
            Pack →
          </button>
        )}
        {viewLocation === 'packing' && (
          <button
            className="btn-move"
            onClick={() =>
              dispatch({ type: 'MOVE_CATEGORY', id: category.id, packingListId: null })
            }
            title="Remove all items from packing list"
          >
            ↩
          </button>
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
        <span
          className="drag-handle"
          draggable
          onPointerDown={() => { isDragHandleActive.current = true; }}
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
      </div>

      {!category.collapsed && (
        <div className="category-body">
          {catItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              viewLocation={viewLocation}
              activePackingListId={activePackingListId}
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
              activePackingListId={activePackingListId}
              dispatch={dispatch}
            />
          ))}

          <AddForm
            placeholder="Add item here…"
            onAdd={name =>
              dispatch({
                type: 'ADD_ITEM',
                name,
                categoryId: category.id,
                packingListId: viewLocation === 'packing' ? activePackingListId : null,
              })
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
  activePackingListId: string | null;
  dispatch: React.Dispatch<Action>;
}

function ItemRow({ item, viewLocation, activePackingListId, dispatch }: ItemRowProps) {
  const dragCtx = useContext(DragContext)!;
  const rowRef = useRef<HTMLDivElement>(null);
  const isDragHandleActive = useRef(false);

  const isDragging = dragCtx.dragging?.id === item.id && dragCtx.dragging.type === 'item';
  const dropPos = dragCtx.dropTarget?.id === item.id ? dragCtx.dropTarget.position : null;

  return (
    <div
      ref={rowRef}
      className={`item-row${item.checked ? ' checked' : ''}${isDragging ? ' is-dragging' : ''}${dropPos ? ` drop-${dropPos}` : ''}${viewLocation === 'inventory' && item.packingListId !== null ? ' in-packing' : ''}`}
      onDragOver={e => dragCtx.onDragOver(e, item.id, 'item')}
      onDrop={e => dragCtx.onDrop(e, item.id, 'item')}
    >
      {viewLocation === 'packing' && (
        <input
          type="checkbox"
          className="item-checkbox"
          checked={item.checked}
          onChange={() => dispatch({ type: 'TOGGLE_CHECK', id: item.id })}
        />
      )}
      {viewLocation === 'inventory' && (
        <button
          className={`btn-move pack${item.packingListId !== null ? ' packed-out' : ''}`}
          onClick={() => {
            if (item.packingListId !== null) {
              dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: null });
            } else {
              dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: activePackingListId });
            }
          }}
          title={item.packingListId !== null ? 'Remove from packing list' : 'Add to packing list'}
        >
          {item.packingListId !== null ? 'Pack ✓' : 'Pack →'}
        </button>
      )}
      <InlineEdit
        value={item.name}
        onSave={name => dispatch({ type: 'RENAME_ITEM', id: item.id, name })}
        className="item-name"
      />
      <div className="item-count">
        <button
          className="count-btn"
          onClick={() => dispatch({ type: 'SET_ITEM_COUNT', id: item.id, count: item.count - 1 })}
          aria-label="Decrease count"
          disabled={item.count <= 1}
        >−</button>
        <span className="count-value">{item.count}</span>
        <button
          className="count-btn"
          onClick={() => dispatch({ type: 'SET_ITEM_COUNT', id: item.id, count: item.count + 1 })}
          aria-label="Increase count"
        >+</button>
      </div>
      <div className="item-actions">
        {viewLocation === 'packing' ? (
          <button
            className="btn-move"
            onClick={() => dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: null })}
            title="Move to inventory"
          >
            ↩
          </button>
        ) : (
          <button
            className="btn-icon danger"
            onClick={() => dispatch({ type: 'DELETE_ITEM', id: item.id })}
            aria-label="Delete item"
          >
            ✕
          </button>
        )}
      </div>
      <span
        className="drag-handle"
        draggable
        onPointerDown={() => { isDragHandleActive.current = true; }}
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
    </div>
  );
}

// ── PackingView ───────────────────────────────────────────────────────────────

interface ViewProps {
  categories: Category[];
  items: Item[];
  activePackingListId: string | null;
  dispatch: React.Dispatch<Action>;
}

interface PackingViewProps extends ViewProps {
  packingLists: PackingList[];
  onNewTrip: () => void;
  onClearChecks: () => void;
}

// ── PackingListBar ─────────────────────────────────────────────────────────────

function PackingListBar({
  packingLists,
  activePackingListId,
  dispatch,
}: {
  packingLists: PackingList[];
  activePackingListId: string | null;
  dispatch: React.Dispatch<Action>;
}) {
  function handleAdd() {
    const name = window.prompt('New packing list name:');
    if (name?.trim()) dispatch({ type: 'ADD_PACKING_LIST', name: name.trim() });
  }

  function handleRename() {
    if (!activePackingListId) return;
    const list = packingLists.find(l => l.id === activePackingListId);
    if (!list) return;
    const name = window.prompt('Rename list:', list.name);
    if (name?.trim() && name.trim() !== list.name) {
      dispatch({ type: 'RENAME_PACKING_LIST', id: activePackingListId, name: name.trim() });
    }
  }

  function handleDelete() {
    if (!activePackingListId || packingLists.length <= 1) return;
    const list = packingLists.find(l => l.id === activePackingListId);
    if (!list) return;
    if (window.confirm(`Delete packing list "${list.name}"? Items will be moved back to inventory.`)) {
      dispatch({ type: 'DELETE_PACKING_LIST', id: activePackingListId });
    }
  }

  return (
    <div className="list-bar">
      <span className="selector-label">List</span>
      <select
        value={activePackingListId ?? ''}
        onChange={e => dispatch({ type: 'SELECT_PACKING_LIST', id: e.target.value })}
        className="selector-select"
      >
        {packingLists.map(list => (
          <option key={list.id} value={list.id}>{list.name}</option>
        ))}
      </select>
      <button className="btn-icon" onClick={handleRename} title="Rename list">✏</button>
      <button className="btn-icon" onClick={handleAdd} title="Add list">+</button>
      <button
        className="btn-icon danger"
        onClick={handleDelete}
        disabled={packingLists.length <= 1}
        title="Delete list"
      >✕</button>
    </div>
  );
}

// ── PackingView ───────────────────────────────────────────────────────────────

function PackingView({
  categories,
  items,
  activePackingListId,
  packingLists,
  dispatch,
  onNewTrip,
  onClearChecks,
}: PackingViewProps) {
  const rootCategories = categories.filter(c => c.parentId === null);
  const uncategorized = items.filter(
    i => i.packingListId === activePackingListId && i.categoryId === null,
  );

  return (
    <DragProvider categories={categories} items={items} dispatch={dispatch}>
      <div className="view">
        <PackingListBar
          packingLists={packingLists}
          activePackingListId={activePackingListId}
          dispatch={dispatch}
        />
        <div className="packing-actions">
          <button className="btn-secondary" onClick={onClearChecks}>
            Clear Checks
          </button>
          <button className="btn-danger" onClick={onNewTrip}>
            New Trip
          </button>
        </div>

        {rootCategories.map(cat => (
          <CategoryTree
            key={cat.id}
            category={cat}
            allCategories={categories}
            items={items}
            depth={0}
            viewLocation="packing"
            activePackingListId={activePackingListId}
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
                  activePackingListId={activePackingListId}
                  dispatch={dispatch}
                />
              ))}
            </div>
          </div>
        )}

        <AddForm
          placeholder="Add item to packing list…"
          onAdd={name =>
            dispatch({ type: 'ADD_ITEM', name, categoryId: null, packingListId: activePackingListId })
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

function InventoryView({ categories, items, activePackingListId, dispatch }: ViewProps) {
  const rootCategories = categories.filter(c => c.parentId === null);
  const uncategorized = items.filter(
    i => i.categoryId === null,
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
            activePackingListId={activePackingListId}
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
                  activePackingListId={activePackingListId}
                  dispatch={dispatch}
                />
              ))}
              <AddForm
                placeholder="Add item here…"
                onAdd={name =>
                  dispatch({ type: 'ADD_ITEM', name, categoryId: null, packingListId: null })
                }
                className="cat-add-item"
              />
            </div>
          </div>
        )}

        <AddForm
          placeholder="Add item to inventory…"
          onAdd={name =>
            dispatch({ type: 'ADD_ITEM', name, categoryId: null, packingListId: null })
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

// ── InventoryBar ──────────────────────────────────────────────────────────────

function InventoryBar({
  inventories,
  activeInventoryId,
  dispatch,
}: {
  inventories: { id: string; name: string }[];
  activeInventoryId: string;
  dispatch: React.Dispatch<Action>;
}) {
  function handleAdd() {
    const name = window.prompt('New inventory name:');
    if (name?.trim()) dispatch({ type: 'ADD_INVENTORY', name: name.trim() });
  }

  function handleRename() {
    const inv = inventories.find(i => i.id === activeInventoryId);
    if (!inv) return;
    const name = window.prompt('Rename inventory:', inv.name);
    if (name?.trim() && name.trim() !== inv.name) {
      dispatch({ type: 'RENAME_INVENTORY', id: activeInventoryId, name: name.trim() });
    }
  }

  function handleDelete() {
    if (inventories.length <= 1) return;
    const inv = inventories.find(i => i.id === activeInventoryId);
    if (!inv) return;
    if (window.confirm(`Delete inventory "${inv.name}" and all its contents?`)) {
      dispatch({ type: 'DELETE_INVENTORY', id: activeInventoryId });
    }
  }

  return (
    <div className="inventory-bar">
      <span className="selector-label">Inventory</span>
      <select
        value={activeInventoryId}
        onChange={e => dispatch({ type: 'SELECT_INVENTORY', id: e.target.value })}
        className="selector-select"
      >
        {inventories.map(inv => (
          <option key={inv.id} value={inv.id}>{inv.name}</option>
        ))}
      </select>
      <button className="btn-icon" onClick={handleRename} title="Rename inventory">✏</button>
      <button className="btn-icon" onClick={handleAdd} title="Add inventory">+</button>
      <button
        className="btn-icon danger"
        onClick={handleDelete}
        disabled={inventories.length <= 1}
        title="Delete inventory"
      >✕</button>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  syncStatus: SyncStatus;
  onSyncClick: () => void;
  onExportClick: () => void;
  onImportClick: () => void;
}

const SYNC_LABELS: Record<SyncStatus, string> = {
  none: 'Enable sync',
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline — changes saved locally',
  error: 'Sync error — click to retry',
};

function Header({ syncStatus, onSyncClick, onExportClick, onImportClick }: HeaderProps) {
  return (
    <header className="app-header">
      <h1 className="app-title">🎒 Packing</h1>
      <div className="header-actions">
        <button
          className="btn-header-action"
          onClick={onExportClick}
          title="Export JSON"
          aria-label="Export JSON"
        >
          ⬇
        </button>
        <button
          className="btn-header-action"
          onClick={onImportClick}
          title="Import JSON"
          aria-label="Import JSON"
        >
          ⬆
        </button>
        <button
          className={`btn-sync btn-sync--${syncStatus}`}
          onClick={onSyncClick}
          title={SYNC_LABELS[syncStatus]}
          aria-label={SYNC_LABELS[syncStatus]}
        >
          <span className="sync-icon">{syncStatus === 'syncing' ? '↻' : '☁'}</span>
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
  const importInputRef = useRef<HTMLInputElement>(null);

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

  const handleExportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `packing-export-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [state]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportJson = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      // Accept both direct app-state exports and optional wrapper objects
      // that store the state payload under a `state` property.
      const wrapped = parsed as { state?: RawState } | null;
      const raw = wrapped && typeof wrapped === 'object' && wrapped.state ? wrapped.state : parsed;
      if (!raw || typeof raw !== 'object') throw new Error('Invalid JSON structure');

      const data = raw as Partial<RawState>;
      if (!Array.isArray(data.inventories) && !Array.isArray(data.items) && !Array.isArray(data.categories)) {
        throw new Error('JSON does not look like packing app data');
      }

      const migrated = migrateState(raw as RawState);
      dispatch({ type: 'IMPORT_STATE', state: migrated });
    } catch (error) {
      console.error('JSON import failed:', error);
      window.alert('Could not import JSON. Please choose a valid export file.');
    } finally {
      e.target.value = '';
    }
  }, [dispatch]);

  // ── List handlers ───────────────────────────────────────────────────────────

  const handleNewTrip = useCallback(() => {
    if (confirm('Start a new trip? All packing items will be moved back to inventory.')) {
      dispatch({ type: 'NEW_TRIP' });
    }
  }, [dispatch]);

  const handleClearChecks = useCallback(() => {
    dispatch({ type: 'CLEAR_CHECKS' });
  }, [dispatch]);

  // ── Active inventory data ────────────────────────────────────────────────────

  const activeInventory = state.inventories.find(inv => inv.id === state.activeInventoryId);
  const categories = activeInventory?.categories ?? [];
  const items = activeInventory?.items ?? [];
  const packingLists = activeInventory?.packingLists ?? [];
  const activePackingListId = activeInventory?.activePackingListId ?? null;

  return (
    <div className="app">
      <Header
        syncStatus={syncStatus}
        onSyncClick={handleSyncClick}
        onExportClick={handleExportJson}
        onImportClick={handleImportClick}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportJson}
        style={{ display: 'none' }}
      />
      <Tabs
        active={state.activeTab}
        onChange={tab => dispatch({ type: 'SET_TAB', tab })}
      />
      <InventoryBar
        inventories={state.inventories}
        activeInventoryId={state.activeInventoryId}
        dispatch={dispatch}
      />
      <main className="app-main">
        {state.activeTab === 'packing' ? (
          <PackingView
            categories={categories}
            items={items}
            activePackingListId={activePackingListId}
            packingLists={packingLists}
            dispatch={dispatch}
            onNewTrip={handleNewTrip}
            onClearChecks={handleClearChecks}
          />
        ) : (
          <InventoryView
            categories={categories}
            items={items}
            activePackingListId={activePackingListId}
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
