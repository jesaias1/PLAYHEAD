import { describe, expect, it, vi } from 'vitest';
import { LoginModal } from '../src/ui/LoginModal';

// Exercise the actual async state machine without a renderer or network account.
function harness(onSubmit = vi.fn(async () => ({ ok: false, detail: 'invalid credentials' }))) {
  const field = (value = '') => ({ value, disabled: false, focus: vi.fn(), setAttribute: vi.fn(), classList: { toggle: vi.fn() } });
  const modal = Object.create(LoginModal.prototype) as any;
  Object.assign(modal, {
    mode: 'login', pending: false, callbacks: { onSubmit },
    usernameInput: field('player'), passwordInput: field('password123'),
    submitBtn: field(), modeRegisterBtn: field(), modeLoginBtn: field(),
    statusElem: field(), element: { setAttribute: vi.fn() },
    setHint: vi.fn(), renderSession: vi.fn(), hide: vi.fn(), isVisible: () => true,
  });
  return { modal, onSubmit, controls: [modal.submitBtn, modal.modeRegisterBtn, modal.modeLoginBtn, modal.usernameInput, modal.passwordInput] };
}

describe('account submission recovery', () => {
  it('recovers from a rejected request and allows retry', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: false, detail: 'bad password' });
    const { modal, controls } = harness(submit);
    await modal.submit();
    expect(modal.pending).toBe(false);
    expect(controls.every(control => !control.disabled)).toBe(true);
    expect(modal.setHint).toHaveBeenCalledWith('CONNECTION FAILED // PLEASE TRY AGAIN', true);
    await modal.submit();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(modal.hide).not.toHaveBeenCalled();
  });
  it('blocks duplicate submits and mode changes while waiting', async () => {
    let finish!: (value: { ok: boolean; detail: string }) => void;
    const submit = vi.fn(() => new Promise<{ ok: boolean; detail: string }>(resolve => { finish = resolve; }));
    const { modal, controls } = harness(submit);
    const pending = modal.submit();
    expect(controls.every(control => control.disabled)).toBe(true);
    modal.setMode('register');
    await modal.submit();
    expect(modal.mode).toBe('login');
    expect(submit).toHaveBeenCalledTimes(1);
    finish({ ok: true, detail: 'ok' });
    await pending;
    expect(modal.passwordInput.value).toBe('');
    expect(modal.renderSession).toHaveBeenCalledWith('player');
    expect(modal.hide).toHaveBeenCalledOnce();
  });
  it('validates short credentials before contacting the server', async () => {
    const { modal, onSubmit } = harness();
    modal.passwordInput.value = 'short';
    await modal.submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(modal.pending).toBe(false);
  });
});
