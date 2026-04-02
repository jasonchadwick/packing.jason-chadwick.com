import { useState } from 'react';

interface PasscodeModalProps {
  mode: 'setup' | 'change';
  onConfirm: (passcode: string) => void;
  onSkip?: () => void;
  onClose?: () => void;
}

export function PasscodeModal({ mode, onConfirm, onSkip, onClose }: PasscodeModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < 4) {
      setError('Passcode must be at least 4 characters.');
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal-title">☁ Sync Across Devices</h2>
        <p className="modal-desc">
          {mode === 'setup'
            ? 'Enter a passcode to sync your packing list across devices. Use the same passcode on any device to access your list.'
            : 'Enter a passcode to switch to that list, or enter a new one to save your current list under it.'}
        </p>
        <form onSubmit={handleSubmit} className="modal-form">
          <input
            className="modal-input"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Enter a passcode…"
            value={value}
            onChange={e => { setValue(e.target.value); setError(''); }}
            autoFocus
          />
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="submit" className="btn-primary">
              {mode === 'setup' ? 'Sync my list' : 'Confirm'}
            </button>
            {mode === 'setup' && onSkip && (
              <button type="button" className="btn-ghost" onClick={onSkip}>
                Use offline only
              </button>
            )}
            {mode === 'change' && onClose && (
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
