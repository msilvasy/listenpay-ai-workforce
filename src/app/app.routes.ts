import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'workspace',
    loadComponent: () => import('./pages/workspace/workspace.component').then(m => m.WorkspaceComponent),
  },
  {
    path: 'programs',
    loadComponent: () => import('./pages/programs/programs.component').then(m => m.ProgramsComponent),
  },
  {
    path: 'industries',
    loadComponent: () => import('./pages/industries/industries.component').then(m => m.IndustriesComponent),
  },
  {
    path: 'secure-documents',
    loadComponent: () =>
      import('./pages/secure-documents/secure-documents.component').then(m => m.SecureDocumentsComponent),
  },
  {
    path: 'legal',
    loadComponent: () => import('./pages/legal/legal.component').then(m => m.LegalComponent),
  },
  { path: '**', redirectTo: '' },
];
