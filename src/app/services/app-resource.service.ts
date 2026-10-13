import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface AppConfig {
  listenPayUrl: string;
}

@Injectable({ providedIn: 'root' })
export class AppResourceService {
  readonly configValue: AppConfig = {
    listenPayUrl: environment.listenPayUrl,
  };
}
