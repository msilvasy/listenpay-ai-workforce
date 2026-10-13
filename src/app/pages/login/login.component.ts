import { AfterViewInit, Component, HostBinding, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ListenPayAuthService } from '../../services/listen-pay-auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements AfterViewInit, OnDestroy {
  // Theme variables (--ink, --copy, etc.) are scoped to :host in the component's
  // CSS, so toggling the theme just means setting this attribute on the host
  // element — no need to touch document.documentElement.
  // Initialised from storage so the first render already has the right theme; setting it later in
  // ngAfterViewInit would miss change detection and leave the page dark while the toggle says LIGHT.
  @HostBinding('attr.data-theme') theme: 'light' | null = LoginComponent.storedTheme() === 'light' ? 'light' : null;

  private static storedTheme(): string | null {
    try {
      return localStorage.getItem('listenpay-portal-theme');
    } catch {
      return null;
    }
  }

  private readonly emailValidationSubject = new Subject<string>();
  private emailValidationSubscription?: Subscription;

  constructor(private router: Router, private listenPayAuthService: ListenPayAuthService) { }

  ngAfterViewInit(): void {
    this.setupThemeToggle();
    this.setupLoginModal();
    this.setupSocialLogin();
  }

  ngOnDestroy(): void {
    this.emailValidationSubscription?.unsubscribe();
    this.emailValidationSubject.complete();
  }

  /** Program Value is public: go straight to Programs without the login challenge. */
  openPrograms(): void {
    this.router.navigateByUrl('/programs');
  }

  private setupThemeToggle(): void {
    const themeToggle = document.getElementById('themeToggle') as HTMLButtonElement | null;
    if (!themeToggle) return;
    const storedTheme = LoginComponent.storedTheme();

    const applyTheme = (theme: string) => {
      const dark = theme === 'dark';
      this.theme = dark ? null : 'light';
      themeToggle.setAttribute('aria-pressed', String(dark));
      themeToggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      const label = themeToggle.querySelector('span:last-child');
      if (label) label.textContent = dark ? 'DARK' : 'LIGHT';
    };

    applyTheme(storedTheme || 'dark');
    themeToggle.addEventListener('click', () => {
      const next = themeToggle.getAttribute('aria-pressed') === 'true' ? 'light' : 'dark';
      localStorage.setItem('listenpay-portal-theme', next);
      applyTheme(next);
    });
  }

  private setupLoginModal(): void {
    const modal = document.getElementById('loginModal') as HTMLDialogElement | null;
    const loginForm = document.getElementById('loginForm') as HTMLFormElement | null;
    const recoveryForm = document.getElementById('recoveryForm') as HTMLFormElement | null;
    const loginView = document.getElementById('loginView');
    const recoveryView = document.getElementById('recoveryView');
    const loginTitle = document.getElementById('loginTitle');
    const loginCopy = document.getElementById('loginCopy');
    const email = document.getElementById('workEmail') as HTMLInputElement | null;
    const role = document.getElementById('role') as HTMLSelectElement | null;
    const accessCode = document.getElementById('accessCode') as HTMLInputElement | null;
    const policyAcknowledgement = document.getElementById('policyAcknowledgement') as HTMLInputElement | null;
    const loginSubmit = document.getElementById('loginSubmit') as HTMLButtonElement | null;
    const loginSpinner = document.getElementById('loginSpinner') as HTMLElement | null;
    const loginSubmitText = document.getElementById('loginSubmitText') as HTMLElement | null;
    const loginStatus = document.getElementById('loginStatus') as HTMLElement | null;
    const verificationSpinner = document.getElementById('verificationSpinner') as HTMLElement | null;
    const recoveryEmail = document.getElementById('recoveryEmail') as HTMLInputElement | null;
    if (!modal || !loginForm || !recoveryForm || !loginView || !recoveryView || !loginTitle || !loginCopy ||
      !email || !role || !accessCode || !policyAcknowledgement || !loginSubmit || !loginSpinner || !loginSubmitText ||
      !loginStatus || !verificationSpinner || !recoveryEmail) {
      return;
    }

    let destination = '/workspace';

    const showView = (view: 'login' | 'recovery') => {
      const recovery = view === 'recovery';
      loginView.classList.toggle('is-active', !recovery);
      recoveryView.classList.toggle('is-active', recovery);
      loginView.setAttribute('aria-hidden', String(recovery));
      recoveryView.setAttribute('aria-hidden', String(!recovery));
      window.setTimeout(() => (recovery ? recoveryEmail : email).focus(), 170);
    };

    const setError = (input: HTMLInputElement, errorId: string, message: string) => {
      const error = document.getElementById(errorId);
      if (error) error.textContent = message || '';
      input.setAttribute('aria-invalid', String(Boolean(message)));
      input.classList.toggle('has-error', Boolean(message));
      return !message;
    };

    const validateEmail = (input: HTMLInputElement, errorId: string, required: boolean) => {
      const value = input.value.trim();
      if (!value) return setError(input, errorId, required ? 'Enter your work email.' : '');
      return setError(
        input,
        errorId,
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Enter a valid email address, for example you@organization.com.',
      );

    };

    const validateAccessCode = (required: boolean) => {
      const value = accessCode.value.trim();
      if (!value) return setError(accessCode, 'accessCodeError', required ? 'Enter your access code.' : '');
      return setError(accessCode, 'accessCodeError', /^[0-9]{6}$/.test(value) ? '' : 'Enter the 6-digit access code.');
    };

    let emailFlowInProgress = false;
    const emailFlowFields: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [
      email,
      role,
      accessCode,
      policyAcknowledgement,
      loginSubmit,
    ];

    const setEmailFlowLoading = (loading: boolean, message = '') => {
      emailFlowInProgress = loading;
      emailFlowFields.forEach(field => {
        field.disabled = loading || field === role || field === accessCode;
      });
      loginSpinner.hidden = !loading;
      loginSubmitText.textContent = loading ? 'PLEASE WAIT...' : 'CONTINUE TO WORKSPACE →';
      loginStatus.textContent = message;
    };

    const showVerificationStep = () => {
      setEmailFlowLoading(false, 'Access code has been sent to your email. Please check your inbox.');
      email.disabled = true;
      role.disabled = true;
      policyAcknowledgement.disabled = true;
      loginSubmit.disabled = true;
      accessCode.disabled = false;
      loginSubmit.hidden = true;
      loginStatus.textContent = 'Enter the 6-digit code from your email.';
      accessCode.focus();
    };

    let verificationInProgress = false;
    const verifyAccessCode = (code: string) => {
      if (verificationInProgress || code.length !== 6) return;
      verificationInProgress = true;
      accessCode.disabled = true;
      verificationSpinner.hidden = false;
      loginStatus.textContent = 'Verifying access code...';

      this.listenPayAuthService.verify2FACode(email.value.trim(), code).pipe(
        catchError(error => of({
          responseCode: 0,
          responseMessage: error?.error?.responseMessage || error?.message || 'We could not verify the access code. Please try again.',
          dataSet: {},
        })),
      ).subscribe(response => {
        const dataSet = response.dataSet as { codeVerifyStatus?: boolean; token?: string; key?: string };
        if (response.responseCode === 1 && dataSet.codeVerifyStatus === true && dataSet.token && dataSet.key) {
          localStorage.setItem('token', dataSet.token);
          localStorage.setItem('key', dataSet.key);
          sessionStorage.setItem('listenpay-authenticated', 'true');
          sessionStorage.setItem('listenpay-portal-requested-workspace', destination);

          if (destination === '/programs') {
            loginStatus.textContent = 'Verification successful. Opening Value Training & Compliance Programs in a new tab...';
            window.open('http://localhost:4300/dashboard', '_blank');
          } else {
            loginStatus.textContent = 'Verification successful. Opening your workspace...';
            this.router.navigateByUrl(destination);
          }
          return;
        }

        verificationInProgress = false;
        accessCode.disabled = false;
        accessCode.value = '';
        verificationSpinner.hidden = true;
        loginStatus.textContent = response.responseCode === 1
          ? 'Invalid or expired access code. Please try again.'
          : response.responseMessage || 'We could not verify the access code. Please try again.';
        accessCode.focus();
      });
    };

    this.emailValidationSubscription = this.emailValidationSubject.pipe(
      debounceTime(700),
      distinctUntilChanged(),
      switchMap(value => {
        if (!value) {
          setEmailFlowLoading(false);
          return EMPTY;
        }

        setEmailFlowLoading(true, 'Please wait... Checking your email');
        return this.listenPayAuthService.ensureAccountAndSendAccessCode(value, message => {
          loginStatus.textContent = message;
        }).pipe(
          catchError(error => of({
            responseCode: 0,
            responseMessage: error?.error?.responseMessage || error?.message || 'We could not process this email. Please try again.',
            dataSet: {},
          })),
        );
      }),
    ).subscribe(response => {
      if (response.responseCode === 1) {
        showVerificationStep();
        return;
      }

      setEmailFlowLoading(false, response.responseMessage || 'We could not process this email. Please try again.');
    });

    email.addEventListener('input', () => {
      const valid = validateEmail(email, 'workEmailError', false);
      if (valid && !emailFlowInProgress) {
        this.emailValidationSubject.next(email.value.trim());
      } else if (!valid) {
        this.emailValidationSubject.next('');
      }
    });
    email.addEventListener('blur', () => validateEmail(email, 'workEmailError', true));
    accessCode.addEventListener('input', () => {
      accessCode.value = accessCode.value.replace(/\D/g, '').slice(0, 6);
      const valid = validateAccessCode(false);
      if (valid && accessCode.value.length === 6) verifyAccessCode(accessCode.value);
    });
    accessCode.addEventListener('blur', () => validateAccessCode(true));
    recoveryEmail.addEventListener('input', event => validateEmail(event.currentTarget as HTMLInputElement, 'recoveryEmailError', false));
    recoveryEmail.addEventListener('blur', event => validateEmail(event.currentTarget as HTMLInputElement, 'recoveryEmailError', true));

    document.querySelectorAll<HTMLElement>('.login-trigger').forEach(tile =>
      tile.addEventListener('click', () => {
        destination = tile.dataset['destination'] || '/workspace';
        const workspace = tile.dataset['workspace'] || 'your workspace';
        loginTitle.textContent = `Sign in to ${workspace}.`;
        loginCopy.textContent = `Use your organization access details to continue to ${workspace}.`;
        showView('login');
        modal.showModal();
        email.focus();
      }),
    );

    const resetLoginModal = () => {
      // Cancel any in-flight email/verification flow so a stale response can't
      // land after the modal has been dismissed and reopened.
      emailFlowInProgress = false;
      verificationInProgress = false;

      // Clear every field the user may have typed into.
      loginForm.reset();
      recoveryForm.reset();

      // Clear validation and status messaging.
      setError(email, 'workEmailError', '');
      setError(accessCode, 'accessCodeError', '');
      setError(recoveryEmail, 'recoveryEmailError', '');
      const loginFormError = document.getElementById('loginFormError');
      if (loginFormError) loginFormError.textContent = '';
      const recoveryStatus = document.getElementById('recoveryStatus');
      if (recoveryStatus) recoveryStatus.textContent = '';
      loginStatus.textContent = '';

      // Restore the fields/buttons to their initial enabled/hidden state,
      // in case the modal was closed mid verification-code flow.
      email.disabled = false;
      role.disabled = true;
      accessCode.disabled = true;
      policyAcknowledgement.disabled = false;
      loginSubmit.disabled = false;
      loginSubmit.hidden = false;
      loginSpinner.hidden = true;
      verificationSpinner.hidden = true;
      loginSubmitText.textContent = 'CONTINUE TO WORKSPACE →';

      // Always come back to the login view, not recovery.
      showView('login');
    };

    document.getElementById('closeLogin')?.addEventListener('click', () => {
      modal.close();
      resetLoginModal();
    });
    document.getElementById('forgotPassword')?.addEventListener('click', () => showView('recovery'));
    document.getElementById('backToLogin')?.addEventListener('click', () => showView('login'));

    const setLoginLoading = (loading: boolean) => {
      loginSubmit.disabled = loading;
      loginSpinner.hidden = !loading;
      loginSubmitText.textContent = loading ? 'AUTHENTICATING…' : 'CONTINUE TO WORKSPACE →';
      loginStatus.textContent = loading ? 'Checking your workspace access…' : '';
    };

    loginForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!verificationInProgress && accessCode.value.length === 6) verifyAccessCode(accessCode.value);
    });

    recoveryForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!validateEmail(recoveryEmail, 'recoveryEmailError', true)) return;
      const status = document.getElementById('recoveryStatus');
      if (status) {
        status.textContent =
          'If an account matches this work email, recovery instructions will be sent through your organization\u2019s configured identity service.';
      }
    });
  }

  private setupSocialLogin(): void {
    const loginNote = document.querySelector('#loginView .login-note');
    if (!loginNote) return;
    const socialSection = document.createElement('section');
    socialSection.className = 'social-login';
    socialSection.setAttribute('aria-label', 'Alternative sign-in options');
    // socialSection.innerHTML =
    //   '<div class="social-divider"><span>or continue with</span></div><div class="social-actions">' +
    //   '<button class="social-auth" type="button" data-provider="Google"><span class="provider-mark" aria-hidden="true">G</span>Continue with Google</button>' +
    //   '<button class="social-auth" type="button" data-provider="Microsoft"><span class="provider-mark microsoft" aria-hidden="true">M</span>Continue with Microsoft</button></div>';
    loginNote.before(socialSection);
    socialSection.querySelectorAll<HTMLButtonElement>('.social-auth').forEach(button =>
      button.addEventListener('click', () => {
        const provider = button.dataset['provider'];
        const status = document.getElementById('loginStatus');
        if (status) {
          status.textContent = `${provider} sign-in is ready to connect. Configure your organization\u2019s ${provider} OAuth or SSO provider before production use.`;
        }
      }),
    );
  }
}
