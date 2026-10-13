import { Component, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AppStorageService } from '../../services/app-storage.service';
import { LoginModalComponent } from '../../shared/login-modal/login-modal.component';

export interface Industry {
  /** Value passed to the dashboard as ?industry=<id> */
  id: 'health-care' | 'industrial' | 'commercial';
  code: string;
  label: string;
  title: string;
  copy: string;
  image: string;
  icon: string;
  imagePosition?: string;
}

@Component({
  selector: 'app-industries',
  standalone: true,
  imports: [RouterLink, LoginModalComponent],
  templateUrl: './industries.component.html',
  styleUrl: './industries.component.css',
})
export class IndustriesComponent {
  @ViewChild(LoginModalComponent) private loginModal!: LoginModalComponent;

  readonly industries: Industry[] = [
    {
      id: 'health-care',
      code: '01',
      label: 'HEALTH CARE',
      title: 'Care-ready teams',
      copy: 'Keep clinical and support staff current on patient privacy, safety protocols, and required credentials between shifts.',
      image: '/industries/healthcare.jpg',
      icon: '/industries/icon-healthcare.png',
      imagePosition: '68% center',
    },
    {
      id: 'industrial',
      code: '02',
      label: 'INDUSTRIAL',
      title: 'Safety on the floor',
      copy: 'Deliver hazard awareness and equipment training in short, audio-first sessions workers can use on the job.',
      image: '/industries/industrial.jpg',
      icon: '/industries/icon-industrial.png',
    },
    {
      id: 'commercial',
      code: '03',
      label: 'COMMERCIAL',
      title: 'Consistent standards',
      copy: 'Align distributed teams on policy, conduct, and wellbeing with records leaders can rely on.',
      image: '/industries/commercial.jpg',
      icon: '/industries/icon-commercial.png',
    },
  ];

  private selected: Industry | null = null;

  constructor(private appStorage: AppStorageService) {}

  select(industry: Industry): void {
    this.selected = industry;
    sessionStorage.setItem('listenpay-selected-industry', industry.id);
    this.loginModal.open(`${this.titleCase(industry.label)} Programs`);
  }

  /**
   * Launches ListenPay Programs (the ListenPay2027 app) themed for the chosen industry.
   * The industry rides in the query string; the JWT rides in the URL fragment, which the
   * browser never sends to a server or writes to access logs. The Programs app reads both on
   * boot, keeps the token in its own sessionStorage and strips the fragment from the address bar.
   */
  onVerified(): void {
    if (!this.selected) return;
    const url = new URL(environment.dashboardUrl);
    url.searchParams.set('industry', this.selected.id);

    const session = this.appStorage.apiSession;
    if (session) {
      url.hash = new URLSearchParams({ access_token: session.token }).toString();
    }
    window.location.href = url.toString();
  }

  private titleCase(value: string): string {
    return value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
}
