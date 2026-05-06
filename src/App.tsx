import { useState, useRef, useEffect, useCallback, createContext, useContext, useMemo } from 'react';
import { useStore } from './useStore';
import type { AppState, Category, Item, Location, PackingList } from './types';
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
  updatePointerTarget: (clientX: number, clientY: number) => void;
  commitPointerDrop: (clientX: number, clientY: number) => void;
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

  const canDropOnTarget = useCallback((
    cur: { id: string; type: 'category' | 'item' },
    targetId: string,
    type: 'category' | 'item',
  ): boolean => {
    if (cur.id === targetId || cur.type !== type) return false;

    if (type === 'category') {
      const draggedCat = categoriesRef.current.find(c => c.id === cur.id);
      const targetCat = categoriesRef.current.find(c => c.id === targetId);
      if (!draggedCat || !targetCat || draggedCat.parentId !== targetCat.parentId) return false;
      return true;
    }

    const draggedItem = itemsRef.current.find(i => i.id === cur.id);
    const targetItem = itemsRef.current.find(i => i.id === targetId);
    if (
      !draggedItem || !targetItem ||
      draggedItem.categoryId !== targetItem.categoryId ||
      draggedItem.packingListId !== targetItem.packingListId
    ) return false;
    return true;
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, targetId: string, type: 'category' | 'item') => {
    const cur = draggingRef.current;
    if (!cur || !canDropOnTarget(cur, targetId, type)) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (dropTargetRef.current?.id !== targetId || dropTargetRef.current?.position !== position) {
      setDropTarget({ id: targetId, position });
    }
  }, [canDropOnTarget]);

  const resolvePointerDropTarget = useCallback((clientX: number, clientY: number) => {
    const cur = draggingRef.current;
    if (!cur) return null;
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const target = element?.closest<HTMLElement>('[data-drag-id][data-drag-type]');
    if (!target) return null;
    const targetId = target.dataset.dragId;
    const targetType = target.dataset.dragType;
    if (!targetId || (targetType !== 'category' && targetType !== 'item')) return null;
    if (!canDropOnTarget(cur, targetId, targetType)) return null;
    const rect = target.getBoundingClientRect();
    const position: 'before' | 'after' = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    return { id: targetId, type: targetType, position };
  }, [canDropOnTarget]);

  const updatePointerTarget = useCallback((clientX: number, clientY: number) => {
    const target = resolvePointerDropTarget(clientX, clientY);
    if (!target) {
      if (dropTargetRef.current !== null) setDropTarget(null);
      return;
    }
    if (dropTargetRef.current?.id !== target.id || dropTargetRef.current?.position !== target.position) {
      setDropTarget({ id: target.id, position: target.position });
    }
  }, [resolvePointerDropTarget]);

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

  const commitPointerDrop = useCallback((clientX: number, clientY: number) => {
    const cur = draggingRef.current;
    const targetFromPointer = resolvePointerDropTarget(clientX, clientY);
    const dt = targetFromPointer
      ? { id: targetFromPointer.id, position: targetFromPointer.position }
      : dropTargetRef.current;
    setDragging(null);
    setDropTarget(null);
    if (!cur || !dt) return;
    if (cur.id === dt.id) return;
    if (cur.type === 'category') {
      dispatch({ type: 'REORDER_CATEGORY', id: cur.id, targetId: dt.id, position: dt.position });
    } else {
      dispatch({ type: 'REORDER_ITEM', id: cur.id, targetId: dt.id, position: dt.position });
    }
  }, [dispatch, resolvePointerDropTarget]);

  const ctx = useMemo(
    () => ({
      dragging,
      dropTarget,
      startDrag,
      endDrag,
      onDragOver,
      onDrop,
      updatePointerTarget,
      commitPointerDrop,
    }),
    [dragging, dropTarget, startDrag, endDrag, onDragOver, onDrop, updatePointerTarget, commitPointerDrop],
  );

  return <DragContext.Provider value={ctx}>{children}</DragContext.Provider>;
}

// ── Weight Context ────────────────────────────────────────────────────────────

interface WeightCtx {
  showWeights: boolean;
  weightUnit: 'g' | 'lbs';
}

const WeightContext = createContext<WeightCtx>({ showWeights: false, weightUnit: 'g' });

/** Minimum oz value to display separately from lbs (avoids "1lb 0.0oz") */
const MIN_OZ_DISPLAY = 0.05;

function formatWeight(g: number, unit: 'g' | 'lbs'): string {
  if (unit === 'g') {
    return g >= 1000 ? `${parseFloat((g / 1000).toFixed(2))}kg` : `${Math.round(g)}g`;
  }
  const totalOz = g / 28.3495;
  const lbs = Math.floor(totalOz / 16);
  const oz = totalOz % 16;
  if (lbs === 0) return `${parseFloat(oz.toFixed(1))}oz`;
  if (oz < MIN_OZ_DISPLAY) return `${lbs}lb`;
  return `${lbs}lb ${parseFloat(oz.toFixed(1))}oz`;
}

function parseWeightGrams(value: string): number | null {
  const v = parseFloat(value);
  if (value.trim() === '' || isNaN(v) || v < 0) return null;
  return v;
}

interface WeightEditProps {
  weightG: number | null;
  editable: boolean;
  onSave: (g: number | null) => void;
}

function WeightEdit({ weightG, editable, onSave }: WeightEditProps) {
  const { showWeights, weightUnit } = useContext(WeightContext);
  const [editing, setEditing] = useState(false);
  const [draftG, setDraftG] = useState('');
  const [draftLbs, setDraftLbs] = useState('');
  const [draftOz, setDraftOz] = useState('');

  if (!showWeights) return null;

  function startEditing() {
    if (!editable) return;
    setEditing(true);
    if (weightUnit === 'g') {
      setDraftG(weightG !== null ? String(Math.round(weightG)) : '');
    } else {
      if (weightG !== null) {
        const totalOz = weightG / 28.3495;
        setDraftLbs(String(Math.floor(totalOz / 16)));
        setDraftOz(parseFloat((totalOz % 16).toFixed(1)).toString());
      } else {
        setDraftLbs('');
        setDraftOz('');
      }
    }
  }

  function commitG() {
    onSave(parseWeightGrams(draftG));
    setEditing(false);
  }

  function commitLbs(e?: React.FocusEvent) {
    if (e) {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest('.weight-lbs-inputs')) return;
    }
    const lbs = parseFloat(draftLbs) || 0;
    const oz = parseFloat(draftOz) || 0;
    if (draftLbs === '' && draftOz === '') {
      onSave(null);
    } else {
      onSave((lbs * 16 + oz) * 28.3495);
    }
    setEditing(false);
  }

  if (editing) {
    if (weightUnit === 'g') {
      return (
        <input
          autoFocus
          className="weight-input"
          type="number"
          min="0"
          placeholder="g"
          value={draftG}
          onChange={e => setDraftG(e.target.value)}
          onBlur={commitG}
          onKeyDown={e => {
            if (e.key === 'Enter') commitG();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={e => e.stopPropagation()}
        />
      );
    }
    return (
      <span className="weight-lbs-inputs" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          className="weight-input weight-input-lb"
          type="number"
          min="0"
          placeholder="lb"
          value={draftLbs}
          onChange={e => setDraftLbs(e.target.value)}
          onBlur={commitLbs}
          onKeyDown={e => {
            if (e.key === 'Enter') commitLbs();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <span className="weight-unit-label">lb</span>
        <input
          className="weight-input weight-input-oz"
          type="number"
          min="0"
          max="16"
          step="0.1"
          placeholder="oz"
          value={draftOz}
          onChange={e => setDraftOz(e.target.value)}
          onBlur={commitLbs}
          onKeyDown={e => {
            if (e.key === 'Enter') commitLbs();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
        <span className="weight-unit-label">oz</span>
      </span>
    );
  }

  const hasWeight = weightG !== null && weightG > 0;
  return (
    <span
      className={`item-weight${editable ? ' item-weight-editable' : ''}${!hasWeight && editable ? ' item-weight-empty' : ''}`}
      onClick={startEditing}
      title={editable ? 'Click to set weight' : undefined}
    >
      {hasWeight ? formatWeight(weightG!, weightUnit) : editable ? '+ weight' : null}
    </span>
  );
}

// ── InlineEdit ────────────────────────────────────────────────────────────────

interface InlineEditProps {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  editable?: boolean;
}

function InlineEdit({ value, onSave, className, editable = true }: InlineEditProps) {
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

  if (!editable) {
    return (
      <span className={`inline-edit-text ${className ?? ''}`}>
        {value}
      </span>
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
  inventoryEditMode?: boolean;
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
  inventoryEditMode = false,
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
  const canEditInventory = viewLocation === 'inventory' && inventoryEditMode;

  return (
    <div
      ref={blockRef}
      data-drag-id={category.id}
      data-drag-type="category"
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
          editable={canEditInventory}
          className={`category-name${viewLocation === 'packing' && category.isContainer && category.packed ? ' packed' : ''}`}
        />
        <WeightEdit
          weightG={category.weightG}
          editable={canEditInventory}
          onSave={g => dispatch({ type: 'SET_CATEGORY_WEIGHT', id: category.id, weightG: g })}
        />
        {viewLocation === 'inventory' && subtreeCount > 0 && (
          <span className="badge">{subtreeCount}</span>
        )}
        {canEditInventory && subtreeCount > 0 && (
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
        {canEditInventory && (
          <button
            className={`btn-icon container-toggle${category.isContainer ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'TOGGLE_CONTAINER', id: category.id })}
            aria-label={category.isContainer ? 'Remove container status' : 'Mark as container'}
            title={category.isContainer ? 'Remove container status' : 'Mark as container (bag, box, etc.)'}
          >
            📦
          </button>
        )}
        {canEditInventory && (
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
        )}
        {canEditInventory && (
          <span
            className="drag-handle"
            draggable
            onPointerDown={e => {
              if (e.pointerType === 'touch') {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragCtx.startDrag(category.id, 'category');
                return;
              }
              isDragHandleActive.current = true;
            }}
            onPointerMove={e => {
              if (e.pointerType !== 'touch') return;
              e.preventDefault();
              dragCtx.updatePointerTarget(e.clientX, e.clientY);
            }}
            onPointerUp={e => {
              if (e.pointerType !== 'touch') return;
              if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              }
              dragCtx.commitPointerDrop(e.clientX, e.clientY);
            }}
            onPointerCancel={e => {
              if (e.pointerType !== 'touch') return;
              if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              }
              dragCtx.endDrag();
            }}
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
        )}
      </div>

      {!category.collapsed && (
        <div className="category-body">
          {catItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              siblingItems={catItems}
              viewLocation={viewLocation}
              activePackingListId={activePackingListId}
              inventoryEditMode={inventoryEditMode}
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
              inventoryEditMode={inventoryEditMode}
              dispatch={dispatch}
            />
          ))}

          {canEditInventory && (
            <AddForm
              placeholder="Add item here…"
              onAdd={name =>
                dispatch({
                  type: 'ADD_ITEM',
                  name,
                  categoryId: category.id,
                  packingListId: null,
                })
              }
              className="cat-add-item"
            />
          )}

          {canEditInventory && (
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
  siblingItems: Item[];
  viewLocation: Location;
  activePackingListId: string | null;
  inventoryEditMode?: boolean;
  dispatch: React.Dispatch<Action>;
}

function ItemRow({
  item,
  siblingItems,
  viewLocation,
  activePackingListId,
  inventoryEditMode = false,
  dispatch,
}: ItemRowProps) {
  const dragCtx = useContext(DragContext)!;
  const rowRef = useRef<HTMLDivElement>(null);
  const isDragHandleActive = useRef(false);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipePointerId = useRef<number | null>(null);
  const swipeTracking = useRef(false);
  const swipeEngaged = useRef(false);
  const swipeOffsetRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeDragging, setSwipeDragging] = useState(false);
  const SWIPE_DELETE_THRESHOLD_PX = 80;
  const SWIPE_MAX_OFFSET_PX = 132;

  useEffect(() => {
    swipeOffsetRef.current = swipeOffset;
  }, [swipeOffset]);

  const resetSwipe = useCallback(() => {
    swipePointerId.current = null;
    swipeTracking.current = false;
    swipeEngaged.current = false;
    setSwipeDragging(false);
    setSwipeOffset(0);
  }, []);

  const isDragging = dragCtx.dragging?.id === item.id && dragCtx.dragging.type === 'item';
  const dropPos = dragCtx.dropTarget?.id === item.id ? dragCtx.dropTarget.position : null;
  const canEditInventory = viewLocation === 'inventory' && inventoryEditMode;
  const itemIndex = siblingItems.findIndex(i => i.id === item.id);
  const hasItemIndex = itemIndex !== -1;
  const prevItem = hasItemIndex && itemIndex > 0 ? siblingItems[itemIndex - 1] : null;
  const nextItem = hasItemIndex && itemIndex < siblingItems.length - 1 ? siblingItems[itemIndex + 1] : null;

  return (
    <div className={`item-row-shell${swipeOffset < 0 ? ' swipe-active' : ''}`}>
      {canEditInventory && (
        <div className="swipe-delete-indicator">Delete</div>
      )}
      <div
        ref={rowRef}
        data-drag-id={item.id}
        data-drag-type="item"
        className={`item-row${item.checked ? ' checked' : ''}${isDragging ? ' is-dragging' : ''}${dropPos ? ` drop-${dropPos}` : ''}${viewLocation === 'inventory' && item.packingListId === activePackingListId && activePackingListId !== null ? ' in-packing' : ''}`}
        onDragOver={e => dragCtx.onDragOver(e, item.id, 'item')}
        onDrop={e => dragCtx.onDrop(e, item.id, 'item')}
        onPointerDown={e => {
          if (!canEditInventory || e.pointerType !== 'touch') return;
          const target = e.target as HTMLElement;
          if (
            target.closest('button, input, select, textarea, a, label') ||
            target.closest('.drag-handle') ||
            target.closest('.inline-edit-input')
          ) return;
          swipePointerId.current = e.pointerId;
          swipeStartX.current = e.clientX;
          swipeStartY.current = e.clientY;
          swipeTracking.current = true;
          swipeEngaged.current = false;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          if (!canEditInventory || e.pointerType !== 'touch') return;
          if (!swipeTracking.current || swipePointerId.current !== e.pointerId) return;
          const dx = e.clientX - swipeStartX.current;
          const dy = e.clientY - swipeStartY.current;

          if (!swipeEngaged.current) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            const isMostlyVertical = Math.abs(dy) > Math.abs(dx);
            if (isMostlyVertical) {
              swipeTracking.current = false;
              return;
            }
            if (dx > 0) {
              swipeTracking.current = false;
              return;
            }
            swipeEngaged.current = true;
            setSwipeDragging(true);
          }

          e.preventDefault();
          setSwipeOffset(Math.max(-SWIPE_MAX_OFFSET_PX, Math.min(0, dx)));
        }}
        onPointerUp={e => {
          if (!canEditInventory || e.pointerType !== 'touch') return;
          if (swipePointerId.current !== e.pointerId) { resetSwipe(); return; }
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          }
          const shouldDelete = swipeEngaged.current && swipeOffsetRef.current <= -SWIPE_DELETE_THRESHOLD_PX;
          if (shouldDelete) dispatch({ type: 'DELETE_ITEM', id: item.id });
          resetSwipe();
        }}
        onPointerCancel={e => {
          if (!canEditInventory || e.pointerType !== 'touch') return;
          if (swipePointerId.current !== e.pointerId) { resetSwipe(); return; }
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          }
          resetSwipe();
        }}
        style={{ transform: `translateX(${swipeOffset}px)`, transition: swipeDragging ? 'none' : 'transform 0.18s ease' }}
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
            className={`btn-move pack${item.packingListId === activePackingListId && activePackingListId !== null ? ' packed-out' : ''}`}
            onClick={() => {
              if (item.packingListId === activePackingListId && activePackingListId !== null) {
                dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: null });
              } else if (activePackingListId !== null) {
                dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: activePackingListId });
              }
            }}
            disabled={activePackingListId === null && item.packingListId === null}
            title={item.packingListId === activePackingListId && activePackingListId !== null ? 'Remove from packing list' : 'Add to packing list'}
          >
            {item.packingListId === activePackingListId && activePackingListId !== null ? 'Pack ✓' : 'Pack →'}
          </button>
        )}
        <InlineEdit
          value={item.name}
          onSave={name => dispatch({ type: 'RENAME_ITEM', id: item.id, name })}
          editable={canEditInventory}
          className="item-name"
        />
        <WeightEdit
          weightG={item.weightG}
          editable={canEditInventory}
          onSave={g => dispatch({ type: 'SET_ITEM_WEIGHT', id: item.id, weightG: g })}
        />
        {viewLocation === 'packing' && (
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
        )}
        <div className="item-actions">
          {viewLocation === 'packing' ? (
            <button
              className="btn-move"
              onClick={() => dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: null })}
              title="Move to inventory"
            >
              ↩
            </button>
          ) : canEditInventory ? (
            <button
              className="btn-icon danger"
              onClick={() => dispatch({ type: 'DELETE_ITEM', id: item.id })}
              aria-label="Delete item"
            >
              ✕
            </button>
          ) : null}
        </div>
        {canEditInventory && (
          <div className="mobile-reorder-controls" aria-label={`Reorder ${item.name}`}>
            <button
              type="button"
              className="btn-icon"
              onClick={e => {
                if (!prevItem) return;
                dispatch({ type: 'REORDER_ITEM', id: item.id, targetId: prevItem.id, position: 'before' });
                const button = e.currentTarget;
                requestAnimationFrame(() => button.focus());
              }}
              disabled={!prevItem}
              aria-label={`Move ${item.name} up`}
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={e => {
                if (!nextItem) return;
                dispatch({ type: 'REORDER_ITEM', id: item.id, targetId: nextItem.id, position: 'after' });
                const button = e.currentTarget;
                requestAnimationFrame(() => button.focus());
              }}
              disabled={!nextItem}
              aria-label={`Move ${item.name} down`}
              title="Move down"
            >
              ↓
            </button>
          </div>
        )}
        {canEditInventory && (
          <span
            className="drag-handle"
            draggable
            onPointerDown={() => {
              isDragHandleActive.current = true;
            }}
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
        )}
      </div>
    </div>
  );
}

// ── Bag utilities ─────────────────────────────────────────────────────────────

/** Returns the set of IDs of a container and all its bag-view descendants. */
function getBagViewSubtreeIds(categories: Category[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  for (const c of categories) {
    if (c.isContainer && c.bagCategoryId === rootId) {
      for (const id of getBagViewSubtreeIds(categories, c.id)) result.add(id);
    }
  }
  return result;
}

// ── BagItemRow ────────────────────────────────────────────────────────────────

interface BagItemRowProps {
  item: Item;
  bags: Category[];
  showBagSelector: boolean;
  dispatch: React.Dispatch<Action>;
}

function BagItemRow({ item, bags, showBagSelector, dispatch }: BagItemRowProps) {
  return (
    <div className={`item-row${item.checked ? ' checked' : ''}`}>
      <input
        type="checkbox"
        className="item-checkbox"
        checked={item.checked}
        onChange={() => dispatch({ type: 'TOGGLE_CHECK', id: item.id })}
      />
      <span className="item-name">{item.name}</span>
      <WeightEdit
        weightG={item.weightG}
        editable={false}
        onSave={g => dispatch({ type: 'SET_ITEM_WEIGHT', id: item.id, weightG: g })}
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
      {showBagSelector && (
        <select
          className="bag-selector"
          value={item.bagCategoryId ?? ''}
          onChange={e =>
            dispatch({ type: 'SET_ITEM_BAG', id: item.id, bagCategoryId: e.target.value || null })
          }
          title="Assign to bag"
          aria-label="Assign to bag"
        >
          <option value="">No bag</option>
          {bags.map(bag => (
            <option key={bag.id} value={bag.id}>{bag.name}</option>
          ))}
        </select>
      )}
      <div className="item-actions">
        <button
          className="btn-move"
          onClick={() => dispatch({ type: 'MOVE_ITEM', id: item.id, packingListId: null })}
          title="Move to inventory"
        >
          ↩
        </button>
      </div>
    </div>
  );
}

// ── BagSection ────────────────────────────────────────────────────────────────

interface BagSectionProps {
  bag: Category;
  allCategories: Category[];
  allBags: Category[];
  packingItems: Item[];
  looseItems: Item[];
  depth: number;
  inventoryEditMode: boolean;
  dispatch: React.Dispatch<Action>;
}

function BagSection({ bag, allCategories, allBags, packingItems, looseItems, depth, inventoryEditMode, dispatch }: BagSectionProps) {
  const dragCtx = useContext(DragContext)!;
  const blockRef = useRef<HTMLDivElement>(null);
  const isDragHandleActive = useRef(false);

  // Items directly inside this container (via inventory categoryId)
  const containerItems = packingItems.filter(i => i.categoryId === bag.id);
  // Sub-bags: containers whose bagCategoryId points to this bag
  const subBags = allBags.filter(b => b.bagCategoryId === bag.id);
  // Loose items explicitly assigned to this bag
  const assignedLooseItems = looseItems.filter(i => i.bagCategoryId === bag.id);

  const directItems = [...containerItems, ...assignedLooseItems];
  const directTotal = directItems.length;
  const directChecked = directItems.reduce((n, i) => n + (i.checked ? 1 : 0), 0);

  // Compute valid parent bag options (exclude self and bag-view descendants to prevent cycles)
  const excluded = getBagViewSubtreeIds(allCategories, bag.id);
  const availableParents = allBags.filter(b => !excluded.has(b.id));

  const isEmpty = containerItems.length === 0 && subBags.length === 0 && assignedLooseItems.length === 0;

  // Pure bags (packingListId !== null) can be edited/deleted; inventory containers cannot be deleted from bag view
  const isPureBag = bag.packingListId !== null;
  const isDragging = dragCtx.dragging?.id === bag.id && dragCtx.dragging.type === 'category';
  const dropPos = dragCtx.dropTarget?.id === bag.id ? dragCtx.dropTarget.position : null;

  return (
    <div
      ref={blockRef}
      data-drag-id={bag.id}
      data-drag-type="category"
      className={`category-block${isDragging ? ' is-dragging' : ''}${dropPos ? ` drop-${dropPos}` : ''}`}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      <div
        className="category-header"
        onDragOver={e => dragCtx.onDragOver(e, bag.id, 'category')}
        onDrop={e => dragCtx.onDrop(e, bag.id, 'category')}
      >
        <button
          className="btn-icon collapse-btn"
          onClick={() => dispatch({ type: 'TOGGLE_COLLAPSE', id: bag.id })}
          aria-label={bag.collapsed ? 'Expand' : 'Collapse'}
        >
          {bag.collapsed ? '▶' : '▼'}
        </button>
        <input
          type="checkbox"
          className="container-packed-checkbox"
          checked={bag.packed}
          onChange={() => dispatch({ type: 'TOGGLE_BAG_PACKED', id: bag.id })}
          title="Mark bag as packed"
        />
        <InlineEdit
          value={bag.name}
          onSave={name => dispatch({ type: 'RENAME_CATEGORY', id: bag.id, name })}
          editable={inventoryEditMode && isPureBag}
          className={`category-name${bag.packed ? ' packed' : ''}`}
        />
        <WeightEdit
          weightG={bag.weightG}
          editable={inventoryEditMode}
          onSave={g => dispatch({ type: 'SET_CATEGORY_WEIGHT', id: bag.id, weightG: g })}
        />
        {directTotal > 0 && (
          <span className="badge">{directChecked}/{directTotal}</span>
        )}
        <select
          className="bag-selector"
          value={bag.bagCategoryId ?? ''}
          onChange={e =>
            dispatch({ type: 'SET_CATEGORY_BAG', id: bag.id, bagCategoryId: e.target.value || null })
          }
          title="Assign bag to parent bag"
          aria-label="Assign bag to parent bag"
        >
          <option value="">Standalone</option>
          {availableParents.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {inventoryEditMode && isPureBag && (
          <button
            className="btn-icon danger"
            onClick={() => {
              if (confirm(`Delete bag "${bag.name}"?`)) {
                dispatch({ type: 'DELETE_CATEGORY', id: bag.id });
              }
            }}
            aria-label="Delete bag"
          >
            ✕
          </button>
        )}
        {inventoryEditMode && (
          <span
            className="drag-handle"
            draggable
            onPointerDown={e => {
              if (e.pointerType === 'touch') {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragCtx.startDrag(bag.id, 'category');
                return;
              }
              isDragHandleActive.current = true;
            }}
            onPointerMove={e => {
              if (e.pointerType !== 'touch') return;
              e.preventDefault();
              dragCtx.updatePointerTarget(e.clientX, e.clientY);
            }}
            onPointerUp={e => {
              if (e.pointerType !== 'touch') return;
              if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              }
              dragCtx.commitPointerDrop(e.clientX, e.clientY);
            }}
            onPointerCancel={e => {
              if (e.pointerType !== 'touch') return;
              if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              }
              dragCtx.endDrag();
            }}
            onDragStart={e => {
              if (!isDragHandleActive.current) { e.preventDefault(); return; }
              isDragHandleActive.current = false;
              e.stopPropagation();
              if (blockRef.current) e.dataTransfer.setDragImage(blockRef.current, 0, 0);
              e.dataTransfer.effectAllowed = 'move';
              dragCtx.startDrag(bag.id, 'category');
            }}
            onDragEnd={() => { isDragHandleActive.current = false; dragCtx.endDrag(); }}
            title="Drag to reorder"
          >
            ⠿
          </span>
        )}
      </div>
      {!bag.collapsed && (
        <div className="category-body">
          {isEmpty && (
            <span className="bag-empty-hint">No items assigned to this bag</span>
          )}
          {containerItems.map(item => (
            <BagItemRow
              key={item.id}
              item={item}
              bags={allBags}
              showBagSelector={false}
              dispatch={dispatch}
            />
          ))}
          {subBags.map(subBag => (
            <BagSection
              key={subBag.id}
              bag={subBag}
              allCategories={allCategories}
              allBags={allBags}
              packingItems={packingItems}
              looseItems={looseItems}
              depth={depth + 1}
              inventoryEditMode={inventoryEditMode}
              dispatch={dispatch}
            />
          ))}
          {assignedLooseItems.map(item => (
            <BagItemRow
              key={item.id}
              item={item}
              bags={allBags}
              showBagSelector={true}
              dispatch={dispatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── BagView ───────────────────────────────────────────────────────────────────

interface BagViewProps {
  categories: Category[];
  items: Item[];
  activePackingListId: string | null;
  inventoryEditMode: boolean;
  dispatch: React.Dispatch<Action>;
}

function BagView({ categories, items, activePackingListId, inventoryEditMode, dispatch }: BagViewProps) {
  // Inventory containers (packingListId: null) are shared across all packing lists;
  // pure bags (packingListId: non-null) only appear for their specific packing list.
  const allBags = categories.filter(c =>
    c.isContainer && (c.packingListId === null || c.packingListId === activePackingListId),
  );
  const containerCatIds = new Set(allBags.map(b => b.id));
  const packingItems = items.filter(i => i.packingListId === activePackingListId);

  // Loose items: not directly inside a container category
  const looseItems = packingItems.filter(
    i => i.categoryId === null || !containerCatIds.has(i.categoryId),
  );

  // Top-level bags: containers with no parent bag assignment
  const topLevelBags = allBags.filter(b => b.bagCategoryId === null);

  // Unassigned: loose items not assigned to any (valid) bag
  const unassigned = looseItems.filter(
    i => i.bagCategoryId === null || !containerCatIds.has(i.bagCategoryId),
  );

  return (
    <>
      {topLevelBags.map(bag => (
        <BagSection
          key={bag.id}
          bag={bag}
          allCategories={categories}
          allBags={allBags}
          packingItems={packingItems}
          looseItems={looseItems}
          depth={0}
          inventoryEditMode={inventoryEditMode}
          dispatch={dispatch}
        />
      ))}

      {unassigned.length > 0 && (
        <div className="category-block uncategorized" style={{ '--depth': 0 } as React.CSSProperties}>
          <div className="category-header">
            <span className="category-name muted">Unassigned</span>
          </div>
          <div className="category-body">
            {unassigned.map(item => (
              <BagItemRow
                key={item.id}
                item={item}
                bags={allBags}
                showBagSelector={true}
                dispatch={dispatch}
              />
            ))}
          </div>
        </div>
      )}

      <AddForm
        placeholder="Add bag…"
        onAdd={name =>
          dispatch({ type: 'ADD_CATEGORY', name, parentId: null, isContainer: true, packingListId: activePackingListId })
        }
        className="bag-add-form"
      />
    </>
  );
}

// ── PackingView ───────────────────────────────────────────────────────────────

interface ViewProps {
  categories: Category[];
  items: Item[];
  activePackingListId: string | null;
  inventoryEditMode?: boolean;
  dispatch: React.Dispatch<Action>;
}

interface PackingViewProps extends ViewProps {
  packingLists: PackingList[];
  inventoryEditMode: boolean;
  onNewTrip: () => void;
  onClearChecks: () => void;
  onOpenPackingListEditor: () => void;
}

// ── PackingListBar ─────────────────────────────────────────────────────────────

function PackingListBar({
  packingLists,
  activePackingListId,
  onOpenPackingListEditor,
  dispatch,
}: {
  packingLists: PackingList[];
  activePackingListId: string | null;
  onOpenPackingListEditor: () => void;
  dispatch: React.Dispatch<Action>;
}) {
  const EDIT_LISTS_OPTION = '__edit_packing_lists__';

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === EDIT_LISTS_OPTION) {
      onOpenPackingListEditor();
      return;
    }
    dispatch({ type: 'SELECT_PACKING_LIST', id: e.target.value });
  }

  return (
    <div className="list-bar">
      <span className="selector-label">List</span>
      <select
        value={activePackingListId ?? ''}
        onChange={handleSelectChange}
        className="selector-select"
      >
        {packingLists.map(list => (
          <option key={list.id} value={list.id}>{list.name}</option>
        ))}
        <option value={EDIT_LISTS_OPTION}>Edit lists…</option>
      </select>
    </div>
  );
}

// ── PackingView ───────────────────────────────────────────────────────────────

function PackingView({
  categories,
  items,
  activePackingListId,
  packingLists,
  inventoryEditMode,
  dispatch,
  onNewTrip,
  onClearChecks,
  onOpenPackingListEditor,
}: PackingViewProps) {
  const { showWeights, weightUnit } = useContext(WeightContext);

  // Total weight: sum of (item.weightG * count) for packed items + bag/container weights
  const totalWeightG = useMemo(() => {
    const packingItems = items.filter(i => i.packingListId === activePackingListId);
    const allBags = categories.filter(
      c => c.isContainer && (c.packingListId === null || c.packingListId === activePackingListId),
    );
    const hasAnyWeight =
      packingItems.some(i => i.weightG !== null) || allBags.some(c => c.weightG !== null);
    if (!hasAnyWeight) return null;
    const itemTotal = packingItems.reduce((sum, i) => sum + (i.weightG ?? 0) * i.count, 0);
    const bagTotal = allBags.reduce((sum, c) => sum + (c.weightG ?? 0), 0);
    return itemTotal + bagTotal;
  }, [items, categories, activePackingListId]);

  return (
    <DragProvider categories={categories} items={items} dispatch={dispatch}>
      <div className="view">
        <PackingListBar
          packingLists={packingLists}
          activePackingListId={activePackingListId}
          onOpenPackingListEditor={onOpenPackingListEditor}
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
        {showWeights && totalWeightG !== null && (
          <div className="total-weight">
            Total weight: <strong>{formatWeight(totalWeightG, weightUnit)}</strong>
          </div>
        )}
        <BagView
          categories={categories}
          items={items}
          activePackingListId={activePackingListId}
          inventoryEditMode={inventoryEditMode}
          dispatch={dispatch}
        />
      </div>
    </DragProvider>
  );
}

// ── InventoryView ─────────────────────────────────────────────────────────────

interface InventoryViewProps extends ViewProps {
  packingLists: PackingList[];
  onOpenPackingListEditor: () => void;
}

function InventoryView({
  categories,
  items,
  activePackingListId,
  packingLists,
  onOpenPackingListEditor,
  inventoryEditMode = false,
  dispatch,
}: InventoryViewProps) {
  // Exclude pure bags (packingListId !== null) — they only belong in bag view
  const inventoryCategories = categories.filter(c => c.packingListId === null);
  const rootCategories = inventoryCategories.filter(c => c.parentId === null);
  const uncategorized = items.filter(
    i => i.categoryId === null,
  );

  return (
    <DragProvider categories={inventoryCategories} items={items} dispatch={dispatch}>
      <div className="view">
        <PackingListBar
          packingLists={packingLists}
          activePackingListId={activePackingListId}
          onOpenPackingListEditor={onOpenPackingListEditor}
          dispatch={dispatch}
        />
        {rootCategories.map(cat => (
          <CategoryTree
            key={cat.id}
            category={cat}
            allCategories={inventoryCategories}
            items={items}
            depth={0}
            viewLocation="inventory"
            activePackingListId={activePackingListId}
            inventoryEditMode={inventoryEditMode}
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
                  siblingItems={uncategorized}
                  viewLocation="inventory"
                  activePackingListId={activePackingListId}
                  inventoryEditMode={inventoryEditMode}
                  dispatch={dispatch}
                />
              ))}
              {inventoryEditMode && (
                <AddForm
                  placeholder="Add item here…"
                  onAdd={name =>
                    dispatch({ type: 'ADD_ITEM', name, categoryId: null, packingListId: null })
                  }
                  className="cat-add-item"
                />
              )}
            </div>
          </div>
        )}

        {inventoryEditMode && (
          <AddForm
            placeholder="Add item to inventory…"
            onAdd={name =>
              dispatch({ type: 'ADD_ITEM', name, categoryId: null, packingListId: null })
            }
            className="root-add"
          />
        )}
        {inventoryEditMode && (
          <AddForm
            placeholder="Add category…"
            onAdd={name => dispatch({ type: 'ADD_CATEGORY', name, parentId: null })}
            className="root-add"
          />
        )}
      </div>
    </DragProvider>
  );
}

function PackingListEditorModal({
  packingLists,
  dispatch,
  onClose,
}: {
  packingLists: PackingList[];
  dispatch: React.Dispatch<Action>;
  onClose: () => void;
}) {
  const [newPackingListName, setNewPackingListName] = useState('');

  function handleAddPackingList(e: React.FormEvent) {
    e.preventDefault();
    const name = newPackingListName.trim();
    if (!name) return;
    dispatch({ type: 'ADD_PACKING_LIST', name });
    setNewPackingListName('');
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit packing lists">
      <div className="modal">
        <h2 className="modal-title">Edit packing lists</h2>
        <div className="inventory-editor-list">
          {packingLists.map(list => (
            <div key={list.id} className="inventory-editor-row">
              <InlineEdit
                value={list.name}
                onSave={name => dispatch({ type: 'RENAME_PACKING_LIST', id: list.id, name })}
                className="inventory-editor-name"
              />
              <button
                type="button"
                className="btn-icon danger"
                onClick={() => {
                  if (packingLists.length <= 1) return;
                  if (window.confirm(`Delete packing list "${list.name}"? Items will be moved back to inventory.`)) {
                    dispatch({ type: 'DELETE_PACKING_LIST', id: list.id });
                  }
                }}
                disabled={packingLists.length <= 1}
                aria-label={`Delete ${list.name}`}
                title="Delete list"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <form className="modal-form" onSubmit={handleAddPackingList}>
          <input
            className="modal-input"
            value={newPackingListName}
            onChange={e => setNewPackingListName(e.target.value)}
            placeholder="New list name…"
          />
          <div className="modal-actions">
            <button type="submit" className="btn-primary">Add list</button>
            <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── InventoryBar ──────────────────────────────────────────────────────────────

function InventoryListEditorModal({
  inventories,
  dispatch,
  onClose,
}: {
  inventories: { id: string; name: string }[];
  dispatch: React.Dispatch<Action>;
  onClose: () => void;
}) {
  const [newInventoryName, setNewInventoryName] = useState('');

  function handleAddInventory(e: React.FormEvent) {
    e.preventDefault();
    const name = newInventoryName.trim();
    if (!name) return;
    dispatch({ type: 'ADD_INVENTORY', name });
    setNewInventoryName('');
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit stuff lists">
      <div className="modal">
        <h2 className="modal-title">Edit lists</h2>
        <div className="inventory-editor-list">
          {inventories.map((inv, idx) => (
            <div key={inv.id} className="inventory-editor-row">
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  const prev = inventories[idx - 1];
                  if (!prev) return;
                  dispatch({ type: 'REORDER_INVENTORY', id: inv.id, targetId: prev.id, position: 'before' });
                }}
                disabled={idx === 0}
                aria-label={`Move ${inv.name} up`}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  const next = inventories[idx + 1];
                  if (!next) return;
                  dispatch({ type: 'REORDER_INVENTORY', id: inv.id, targetId: next.id, position: 'after' });
                }}
                disabled={idx === inventories.length - 1}
                aria-label={`Move ${inv.name} down`}
                title="Move down"
              >
                ↓
              </button>
              <InlineEdit
                value={inv.name}
                onSave={name => dispatch({ type: 'RENAME_INVENTORY', id: inv.id, name })}
                className="inventory-editor-name"
              />
              <button
                type="button"
                className="btn-icon danger"
                onClick={() => {
                  if (inventories.length <= 1) return;
                  if (window.confirm(`Delete list "${inv.name}" and all its contents?`)) {
                    dispatch({ type: 'DELETE_INVENTORY', id: inv.id });
                  }
                }}
                disabled={inventories.length <= 1}
                aria-label={`Delete ${inv.name}`}
                title="Delete list"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <form className="modal-form" onSubmit={handleAddInventory}>
          <input
            className="modal-input"
            value={newInventoryName}
            onChange={e => setNewInventoryName(e.target.value)}
            placeholder="New list name…"
          />
          <div className="modal-actions">
            <button type="submit" className="btn-primary">Add list</button>
            <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InventoryBar({
  inventories,
  activeInventoryId,
  inventoryEditMode,
  onToggleInventoryEditMode,
  showWeights,
  onToggleShowWeights,
  weightUnit,
  onSetWeightUnit,
  onOpenInventoryEditor,
  dispatch,
}: {
  inventories: { id: string; name: string }[];
  activeInventoryId: string;
  inventoryEditMode: boolean;
  onToggleInventoryEditMode: () => void;
  showWeights: boolean;
  onToggleShowWeights: () => void;
  weightUnit: 'g' | 'lbs';
  onSetWeightUnit: (u: 'g' | 'lbs') => void;
  onOpenInventoryEditor: () => void;
  dispatch: React.Dispatch<Action>;
}) {
  const EDIT_LISTS_OPTION = '__edit_lists__';
  const EDIT_MODE_TOGGLE_ID = 'inventory-edit-mode-toggle';
  const SHOW_WEIGHTS_TOGGLE_ID = 'show-weights-toggle';

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === EDIT_LISTS_OPTION) {
      onOpenInventoryEditor();
      return;
    }
    dispatch({ type: 'SELECT_INVENTORY', id: e.target.value });
  }

  return (
    <div className="inventory-bar">
      <span className="selector-label">Inventory</span>
      <select
        value={activeInventoryId}
        onChange={handleSelectChange}
        className="selector-select"
      >
        {inventories.map(inv => (
          <option key={inv.id} value={inv.id}>{inv.name}</option>
        ))}
        <option value={EDIT_LISTS_OPTION}>Edit lists…</option>
      </select>
      <span className="selector-label">Edit</span>
      <label className="apple-toggle" title="Toggle edit mode">
        <input
          id={EDIT_MODE_TOGGLE_ID}
          type="checkbox"
          checked={inventoryEditMode}
          onChange={onToggleInventoryEditMode}
          aria-label="Toggle edit mode"
        />
        <span className="apple-toggle-slider" />
      </label>
      <span className="selector-label">Weights</span>
      <label className="apple-toggle" title="Toggle weight display">
        <input
          id={SHOW_WEIGHTS_TOGGLE_ID}
          type="checkbox"
          checked={showWeights}
          onChange={onToggleShowWeights}
          aria-label="Toggle weight display"
        />
        <span className="apple-toggle-slider" />
      </label>
      {showWeights && (
        <select
          className="weight-unit-select"
          value={weightUnit}
          onChange={e => onSetWeightUnit(e.target.value as 'g' | 'lbs')}
          aria-label="Weight unit"
          title="Weight unit"
        >
          <option value="g">g</option>
          <option value="lbs">lbs</option>
        </select>
      )}
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
      <h1 className="app-title">Crate</h1>
      <div className="header-actions">
        <button
          className="btn-header-action"
          onClick={onExportClick}
          title="Export JSON"
          aria-label="Export JSON"
        >
          Export
        </button>
        <button
          className="btn-header-action"
          onClick={onImportClick}
          title="Import JSON"
          aria-label="Import JSON"
        >
          Import
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
  const [importCandidateState, setImportCandidateState] = useState<AppState | null>(null);
  const [inventoryEditMode, setInventoryEditMode] = useState(false);
  const [isInventoryEditorOpen, setIsInventoryEditorOpen] = useState(false);
  const [isPackingListEditorOpen, setIsPackingListEditorOpen] = useState(false);
  const [showWeights, setShowWeights] = useState(() => localStorage.getItem('show-weights') === 'true');
  const [weightUnit, setWeightUnit] = useState<'g' | 'lbs'>(() =>
    localStorage.getItem('weight-unit') === 'lbs' ? 'lbs' : 'g',
  );

  function handleToggleShowWeights() {
    setShowWeights(v => {
      const next = !v;
      localStorage.setItem('show-weights', String(next));
      return next;
    });
  }

  function handleSetWeightUnit(u: 'g' | 'lbs') {
    setWeightUnit(u);
    localStorage.setItem('weight-unit', u);
  }

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
      const hasNestedInventories = Array.isArray(data.inventories) && data.inventories.length > 0;
      const hasLegacyData = Array.isArray(data.items) || Array.isArray(data.categories);
      if (!hasNestedInventories && !hasLegacyData) {
        throw new Error('JSON does not look like packing app data');
      }

      const migrated = migrateState(raw as RawState);
      setImportCandidateState(migrated);
    } catch (error) {
      console.error('JSON import failed:', error);
      const reason = error instanceof Error ? error.message : 'unknown error';
      window.alert(`Could not import JSON: ${reason}`);
    } finally {
      e.target.value = '';
    }
  }, []);

  const handleImportReplace = useCallback(() => {
    if (!importCandidateState) return;
    dispatch({ type: 'IMPORT_STATE', state: importCandidateState });
    setImportCandidateState(null);
  }, [dispatch, importCandidateState]);

  const handleImportMerge = useCallback(() => {
    if (!importCandidateState) return;
    dispatch({ type: 'MERGE_STATE', state: importCandidateState });
    setImportCandidateState(null);
  }, [dispatch, importCandidateState]);

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
    <WeightContext.Provider value={{ showWeights, weightUnit }}>
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
        inventoryEditMode={inventoryEditMode}
        onToggleInventoryEditMode={() => setInventoryEditMode(v => !v)}
        showWeights={showWeights}
        onToggleShowWeights={handleToggleShowWeights}
        weightUnit={weightUnit}
        onSetWeightUnit={handleSetWeightUnit}
        onOpenInventoryEditor={() => setIsInventoryEditorOpen(true)}
        dispatch={dispatch}
      />
      <main className="app-main">
        {state.activeTab === 'packing' ? (
          <PackingView
            categories={categories}
            items={items}
            activePackingListId={activePackingListId}
            packingLists={packingLists}
            inventoryEditMode={inventoryEditMode}
            dispatch={dispatch}
            onNewTrip={handleNewTrip}
            onClearChecks={handleClearChecks}
            onOpenPackingListEditor={() => setIsPackingListEditorOpen(true)}
          />
        ) : (
          <InventoryView
            categories={categories}
            items={items}
            activePackingListId={activePackingListId}
            packingLists={packingLists}
            onOpenPackingListEditor={() => setIsPackingListEditorOpen(true)}
            inventoryEditMode={inventoryEditMode}
            dispatch={dispatch}
          />
        )}
      </main>
      {isInventoryEditorOpen && (
        <InventoryListEditorModal
          inventories={state.inventories}
          dispatch={dispatch}
          onClose={() => setIsInventoryEditorOpen(false)}
        />
      )}
      {isPackingListEditorOpen && (
        <PackingListEditorModal
          packingLists={packingLists}
          dispatch={dispatch}
          onClose={() => setIsPackingListEditorOpen(false)}
        />
      )}
      {modalMode && (
        <PasscodeModal
          mode={modalMode}
          onConfirm={handlePasscodeConfirm}
          onSkip={modalMode === 'setup' ? handleSkip : undefined}
          onClose={modalMode === 'change' ? () => setModalMode(null) : undefined}
        />
      )}
      {importCandidateState && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose import mode">
          <div className="modal">
            <h2 className="modal-title">Import JSON</h2>
            <p className="modal-desc">
              Choose how to import this file.
              <br />
              Full replacement will replace all current data.
              <br />
              Merge keeps your current data and merges categories with the same name.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn-danger" onClick={handleImportReplace}>
                Full replacement
              </button>
              <button type="button" className="btn-primary" onClick={handleImportMerge}>
                Merge
              </button>
              <button type="button" className="btn-ghost" onClick={() => setImportCandidateState(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </WeightContext.Provider>
  );
}
