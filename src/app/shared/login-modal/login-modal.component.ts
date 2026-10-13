import { Component, ElementRef, EventEmitter, OnDestroy, OnInit, Output, ViewChild, WritableSignal, signal } from '@angular/core';
import { EMPTY, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ListenPayAuthService } from '../../services/listen-pay-auth.service';

type ModalView = 'login' | 'recovery';
type Step = 'email' | 'code' | 'verifying' | 'done';

/**
 * Reusable ListenPay sign-in dialog (email -> emailed 6-digit code -> verify).
 * Mirrors the portal login modal on the Login page.
 *
 * Usage:
 *   <app-login-modal #login (verified)="onVerified()"></app-login-modal>
 *   login.open('Health Care Programs');
 */
@Component({
  selector: 'app-login-modal',
  standalone: true,
  imports: [],
  templateUrl: './login-modal.component.html',
  styleUrl: './login-modal.component.css',
})
export class LoginModalComponent implements OnInit, OnDestroy {
  /** Fires once the access code is verified and the token is stored. */
  @Output() verified = new EventEmitter<void>();

  @ViewChild('dialog', { static: true }) private dialogRef!: ElementRef<HTMLDialogElement>;
  @ViewChild('emailInput', { static: true }) private emailInput!: ElementRef<HTMLInputElement>;
  @ViewChild('codeInput', { static: true }) private codeInput!: ElementRef<HTMLInputElement>;
  @ViewChild('recoveryInput', { static: true }) private recoveryInput!: ElementRef<HTMLInputElement>;

  readonly workspace = signal('your workspace');
  readonly view = signal<ModalView>('login');
  readonly step = signal<Step>('email');
  readonly busy = signal(false);
  readonly status = signal('');
  readonly emailError = signal('');
  readonly codeError = signal('');
  readonly recoveryError = signal('');
  readonly recoveryStatus = signal('');

  email = '';
  code = '';
  recoveryEmail = '';
  policyAccepted = true;

  private readonly emailSubject = new Subject<string>();
  private emailSub?: Subscription;
  private verifySub?: Subscription;

  constructor(private auth: ListenPayAuthService) {}

  ngOnInit(): void {
    this.emailSub = this.emailSubject.pipe(
      debounceTime(700),
      distinctUntilChanged(),
      switchMap(value => {
        if (!value) {
          this.busy.set(false);
          this.status.set('');
          return EMPTY;
        }
        this.busy.set(true);
        this.status.set('Please wait... Checking your email');
        return this.auth.ensureAccountAndSendAccessCode(value, message => this.status.set(message)).pipe(
          catchError(error => of({
            responseCode: 0,
            responseMessage: error?.error?.responseMessage || error?.message || 'We could not process this email. Please try again.',
            dataSet: {},
          })),
        );
      }),
    ).subscribe(response => {
      this.busy.set(false);
      if (response.responseCode === 1) {
        this.step.set('code');
        this.status.set('Access code has been sent to your email. Enter the 6-digit code.');
        setTimeout(() => this.codeInput.nativeElement.focus());
        return;
      }
      this.status.set(response.responseMessage || 'We could not process this email. Please try again.');
    });
  }

  ngOnDestroy(): void {
    this.emailSub?.unsubscribe();
    this.verifySub?.unsubscribe();
    this.emailSubject.complete();
  }

  open(workspace: string): void {
    this.reset();
    this.workspace.set(workspace);
    this.dialogRef.nativeElement.showModal();
    this.emailInput.nativeElement.focus();
  }

  close(): void {
    this.dialogRef.nativeElement.close();
    this.reset();
  }

  showView(view: ModalView): void {
    this.view.set(view);
    setTimeout(() => (view === 'recovery' ? this.recoveryInput : this.emailInput).nativeElement.focus(), 170);
  }

  onEmailInput(value: string): void {
    this.email = value;
    const valid = this.validateEmail(value, false, this.emailError);
    if (valid && !this.busy()) this.emailSubject.next(value.trim());
    else if (!valid) this.emailSubject.next('');
  }

  onEmailBlur(): void {
    this.validateEmail(this.email, true, this.emailError);
  }

  onCodeInput(input: HTMLInputElement): void {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    this.code = input.value;
    const valid = this.validateCode(false);
    if (valid && this.code.length === 6) this.verifyCode();
  }

  onCodeBlur(): void {
    this.validateCode(true);
  }

  submitLogin(event: Event): void {
    event.preventDefault();
    if (this.step() === 'code' && this.code.length === 6) this.verifyCode();
  }

  submitRecovery(event: Event): void {
    event.preventDefault();
    if (!this.validateEmail(this.recoveryEmail, true, this.recoveryError)) return;
    this.recoveryStatus.set(
      'If an account matches this work email, recovery instructions will be sent through your organization’s configured identity service.',
    );
  }

  onRecoveryInput(value: string): void {
    this.recoveryEmail = value;
    this.validateEmail(value, false, this.recoveryError);
  }

  private verifyCode(): void {
    if (this.step() === 'verifying' || this.code.length !== 6) return;
    this.step.set('verifying');
    this.status.set('Verifying access code...');

    this.verifySub = this.auth.verify2FACode(this.email.trim(), this.code).pipe(
      catchError(error => of({
        responseCode: 0,
        responseMessage: error?.error?.responseMessage || error?.message || 'We could not verify the access code. Please try again.',
        dataSet: {},
      })),
    ).subscribe(response => {
      const data = response.dataSet as { codeVerifyStatus?: boolean; token?: string; key?: string };
      if (response.responseCode === 1 && data.codeVerifyStatus === true && data.token && data.key) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('key', data.key);
        sessionStorage.setItem('listenpay-authenticated', 'true');
        this.step.set('done');
        this.status.set(`Verification successful. Opening ${this.workspace()}...`);
        this.verified.emit();
        return;
      }

      this.step.set('code');
      this.code = '';
      this.codeInput.nativeElement.value = '';
      this.status.set(response.responseCode === 1
        ? 'Invalid or expired access code. Please try again.'
        : response.responseMessage || 'We could not verify the access code. Please try again.');
      setTimeout(() => this.codeInput.nativeElement.focus());
    });
  }

  private validateEmail(value: string, required: boolean, target: WritableSignal<string>): boolean {
    const v = value.trim();
    let message = '';
    if (!v) message = required ? 'Enter your work email.' : '';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) message = 'Enter a valid email address, for example you@organization.com.';
    target.set(message);
    return !message;
  }

  private validateCode(required: boolean): boolean {
    const v = this.code.trim();
    let message = '';
    if (!v) message = required ? 'Enter your access code.' : '';
    else if (!/^[0-9]{6}$/.test(v)) message = 'Enter the 6-digit access code.';
    this.codeError.set(message);
    return !message;
  }

  private reset(): void {
    this.verifySub?.unsubscribe();
    this.emailSubject.next('');
    this.email = '';
    this.code = '';
    this.recoveryEmail = '';
    this.policyAccepted = true;
    this.emailInput.nativeElement.value = '';
    this.codeInput.nativeElement.value = '';
    this.recoveryInput.nativeElement.value = '';
    this.emailError.set('');
    this.codeError.set('');
    this.recoveryError.set('');
    this.recoveryStatus.set('');
    this.status.set('');
    this.busy.set(false);
    this.step.set('email');
    this.view.set('login');
  }
}
