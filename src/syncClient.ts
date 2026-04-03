import type { AppState } from './types';
import { migrateState } from './migrate';
import type { RawState } from './migrate';

const LIST_ID_KEY = 'packing-list-id';         // stored value is the SHA-256 hash
const OFFLINE_FLAG_KEY = 'packing-list-offline-only';
const DEBOUNCE_MS = 1500;

export type SyncStatus = 'none' | 'syncing' | 'synced' | 'offline' | 'error';

// ── Storage helpers ───────────────────────────────────────────────────────────

/** Returns the stored list ID (SHA-256 hash of the passcode), or null. */
export function loadListId(): string | null {
  try { return localStorage.getItem(LIST_ID_KEY); }
  catch { return null; }
}

/**
 * Derives the list ID from the passcode (SHA-256), persists only the hash,
 * and returns it so the caller can update state.
 * The raw passcode is never written to any persistent storage.
 */
export async function savePasscode(passcode: string): Promise<string> {
  const id = await deriveListId(passcode);
  try {
    localStorage.setItem(LIST_ID_KEY, id);
    localStorage.removeItem(OFFLINE_FLAG_KEY);
  } catch { /* ignore */ }
  return id;
}

export function isOfflineOnly(): boolean {
  try { return localStorage.getItem(OFFLINE_FLAG_KEY) === 'true'; }
  catch { return false; }
}

export function setOfflineOnly(): void {
  try { localStorage.setItem(OFFLINE_FLAG_KEY, 'true'); }
  catch { /* ignore */ }
}

// ── Crypto ────────────────────────────────────────────────────────────────────

/** SHA-256 of the passcode, hex-encoded — this becomes the KV key / list ID. */
async function deriveListId(passcode: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passcode));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Remote API ────────────────────────────────────────────────────────────────

/** Returns the remote list state for the given list ID, or null if not found. */
export async function fetchRemoteState(listId: string): Promise<AppState | null> {
  const res = await fetch(`/api/list/${listId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as RawState;
  return migrateState(data);
}

/** Pushes the current list state to the remote. */
export async function pushState(listId: string, state: AppState): Promise<void> {
  const res = await fetch(`/api/list/${listId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventories: state.inventories }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ── Debounced push ────────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancels any pending debounced push. */
export function cancelPush(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Schedules a debounced push and reports status via onStatus. */
export function schedulePush(
  listId: string,
  state: AppState,
  onStatus: (s: SyncStatus) => void,
): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    onStatus('syncing');
    try {
      await pushState(listId, state);
      onStatus('synced');
    } catch {
      // Use navigator.onLine only to differentiate error display; actual
      // connectivity is determined by whether the push threw.
      onStatus(navigator.onLine ? 'error' : 'offline');
    }
  }, DEBOUNCE_MS);
}
