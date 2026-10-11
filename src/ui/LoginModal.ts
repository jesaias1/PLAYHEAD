/**
 * LOGIN MODAL — create or sign into a USERNAME + PASSWORD account.
 *
 * No email, no signup wall: the player can keep playing anonymously and only
 * create a durable account when they want one. Username uniqueness, password
 * hashing and the session are handled server-side by the `account-auth` Edge
 * Function; this modal only collects the two fields and reports the REAL result.
 *
 * It reuses the existing terminal panel styling (profile container, sections and
 * terminal buttons) rather than introducing a new visual language.
 */

import { ModalFocus } from './ModalFocus';

export interface LoginModalCallbacks {
  onSubmit: (
    mode: 'register' | 'login',
    username: string,
    password: string
  ) => Promise<{ ok: boolean; detail: string }>;
  /** Signs the current account out and restores the device's guest state. */
  onSignOut?: () => Promise<void>;
  onClose?: () => void;
}

export class LoginModal {
  public element: HTMLElement;

  private statusElem: HTMLElement;
  private usernameInput: HTMLInputElement;
  private passwordInput: HTMLInputElement;
  private submitBtn: HTMLButtonElement;
  private modeRegisterBtn: HTMLButtonElement;
  private modeLoginBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private hintElem: HTMLElement;
  private signOutBtn: HTMLButtonElement;
  private formSections: HTMLElement[];
  private signedInElem: HTMLElement;

  private mode: 'register' | 'login' = 'register';
  private pending = false;
  private focus: ModalFocus;
  private callbacks: LoginModalCallbacks = { onSubmit: async () => ({ ok: false, detail: '' }) };

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'screen profile-screen hidden';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', 'login-title');
    this.element.innerHTML = `
      <div class="profile-container">
        <div class="profile-header">
          <div class="profile-title-group">
            <div class="profile-kicker">[IDENTITY] SIGNAL ACCOUNT</div>
            <h3 class="profile-title" id="login-title">ACCOUNT</h3>
            <div class="profile-status" id="login-status"></div>
          </div>
          <button class="terminal-btn-subtle" id="btn-login-close" type="button">[ CLOSE ]</button>
        </div>

        <div class="profile-section" id="login-signedin" style="display:none">
          <div class="profile-section-title">SIGNED IN AS</div>
          <div class="profile-status" id="login-signedin-name">-</div>
          <div class="profile-rename">
            <button class="terminal-btn-subtle" id="btn-login-signout" type="button">[ SIGN OUT ]</button>
          </div>
        </div>

        <div class="profile-section" data-login-form>
          <div class="profile-section-title">MODE</div>
          <div class="armory-slots" role="tablist" aria-label="Account mode">
            <button class="armory-slot-btn active" id="login-mode-register" type="button">[ CREATE ]</button>
            <button class="armory-slot-btn" id="login-mode-login" type="button">[ SIGN IN ]</button>
          </div>
        </div>

        <div class="profile-section" data-login-form>
          <label class="profile-label" for="login-username">USERNAME</label>
          <input class="online-input" id="login-username" type="text" maxlength="20"
                 autocomplete="username" spellcheck="false" autocapitalize="none" />
          <label class="profile-label" for="login-password">PASSWORD</label>
          <input class="online-input" id="login-password" type="password"
                 autocomplete="current-password" spellcheck="false" />
          <div class="profile-rename-hint" id="login-hint" role="status" aria-live="polite"></div>
          <div class="profile-rename" id="login-submit-row">
            <button class="terminal-btn-subtle" id="btn-login-submit" type="button">[ CREATE ACCOUNT ]</button>
          </div>
          <div class="online-lobby-status" id="login-note">
            KEEP YOUR PROGRESS ACROSS DEVICES. NO EMAIL REQUIRED.
          </div>
        </div>
      </div>
    `;

    this.statusElem = this.element.querySelector('#login-status') as HTMLElement;
    this.usernameInput = this.element.querySelector('#login-username') as HTMLInputElement;
    this.passwordInput = this.element.querySelector('#login-password') as HTMLInputElement;
    this.submitBtn = this.element.querySelector('#btn-login-submit') as HTMLButtonElement;
    this.modeRegisterBtn = this.element.querySelector('#login-mode-register') as HTMLButtonElement;
    this.modeLoginBtn = this.element.querySelector('#login-mode-login') as HTMLButtonElement;
    this.closeBtn = this.element.querySelector('#btn-login-close') as HTMLButtonElement;
    this.hintElem = this.element.querySelector('#login-hint') as HTMLElement;
    this.signOutBtn = this.element.querySelector('#btn-login-signout') as HTMLButtonElement;
    this.formSections = Array.from(this.element.querySelectorAll('[data-login-form]')) as HTMLElement[];
    this.signedInElem = this.element.querySelector('#login-signedin') as HTMLElement;

    this.focus = new ModalFocus(this.element, () => this.closeBtn.click());

    this.modeRegisterBtn.addEventListener('click', () => this.setMode('register'));
    this.modeLoginBtn.addEventListener('click', () => this.setMode('login'));
    this.submitBtn.addEventListener('click', () => void this.submit());
    this.signOutBtn.addEventListener('click', () => void this.signOut());
    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.callbacks.onClose?.();
    });
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.hide();
        this.callbacks.onClose?.();
      }
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.pending && (e.target === this.usernameInput || e.target === this.passwordInput)) {
        e.preventDefault();
        void this.submit();
      }
    });
  }

  public setCallbacks(callbacks: LoginModalCallbacks): void {
    this.callbacks = callbacks;
  }

  public isVisible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  public hide(): void {
    this.focus.close();
    this.passwordInput.value = '';
  }

  public show(): void {
    this.setMode(this.mode);
    this.setHint('', false);
    this.focus.open(this.signedInElem.classList.contains('hidden') ? this.usernameInput : this.signOutBtn);
  }

  /**
   * Reflects the REAL session: a signed-in account shows SIGN OUT; an anonymous
   * device shows CREATE / SIGN IN. Driven by AuthService, never guessed.
   */
  public renderSession(username: string | null): void {
    const signedIn = !!username;
    for (const section of this.formSections) section.style.display = signedIn ? 'none' : '';
    this.signedInElem.style.display = signedIn ? '' : 'none';
    for (const section of this.formSections) section.classList.toggle('hidden', signedIn);
    this.signedInElem.classList.toggle('hidden', !signedIn);
    if (signedIn) {
      const nameElem = this.element.querySelector('#login-signedin-name') as HTMLElement | null;
      if (nameElem) nameElem.textContent = username ?? '';
    }
  }

  private async signOut(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.signOutBtn.disabled = true;
    try {
      await this.callbacks.onSignOut?.();
      this.setHint('SIGNED OUT // LOCAL PROGRESS PRESERVED', false);
      this.hide();
      this.callbacks.onClose?.();
    } catch {
      this.setHint('SIGN OUT FAILED', true);
    } finally {
      this.pending = false;
      this.signOutBtn.disabled = false;
    }
  }

  private setMode(mode: 'register' | 'login'): void {
    if (this.pending) return;
    this.mode = mode;
    const register = mode === 'register';
    this.passwordInput.autocomplete = register ? 'new-password' : 'current-password';
    this.modeRegisterBtn.setAttribute('aria-pressed', String(register));
    this.modeLoginBtn.setAttribute('aria-pressed', String(!register));
    this.modeRegisterBtn.classList.toggle('active', register);
    this.modeLoginBtn.classList.toggle('active', !register);
    this.submitBtn.textContent = register ? '[ CREATE ACCOUNT ]' : '[ SIGN IN ]';
    this.statusElem.textContent = register
      ? 'NEW ACCOUNT // USERNAME ONLY'
      : 'EXISTING ACCOUNT';
  }

  private setHint(text: string, isError: boolean): void {
    this.hintElem.textContent = text;
    this.hintElem.classList.toggle('error', isError);
  }

  private async submit(): Promise<void> {
    if (this.pending) return;
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value;
    if (username.length < 3) {
      this.setHint('USERNAME MUST BE AT LEAST 3 CHARACTERS', true);
      return;
    }
    if (password.length < 8) {
      this.setHint('PASSWORD MUST BE AT LEAST 8 CHARACTERS', true);
      return;
    }
    const mode = this.mode;
    this.pending = true;
    const controls = [this.submitBtn, this.modeRegisterBtn, this.modeLoginBtn, this.usernameInput, this.passwordInput];
    controls.forEach((control) => { control.disabled = true; });
    this.element.setAttribute('aria-busy', 'true');
    this.setHint(mode === 'register' ? 'CREATING ACCOUNT...' : 'SIGNING IN...', false);
    try {
      const result = await this.callbacks.onSubmit(mode, username, password);
      if (result.ok) {
        this.passwordInput.value = '';
        this.setHint(mode === 'register' ? 'ACCOUNT CREATED' : 'SIGNED IN', false);
        this.renderSession(username);
        this.hide();
      } else {
        this.setHint(result.detail.toUpperCase(), true);
      }
    } catch {
      this.setHint('CONNECTION FAILED // PLEASE TRY AGAIN', true);
    } finally {
      this.pending = false;
      controls.forEach((control) => { control.disabled = false; });
      this.element.setAttribute('aria-busy', 'false');
      if (this.isVisible()) this.passwordInput.focus();
    }
  }
}
