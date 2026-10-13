import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { ConfigService } from './services/config.service';

function initializeConfig(configService: ConfigService): () => Promise<void> {
  return () => configService.load();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    // {
    //   provide: APP_INITIALIZER,
    //   useFactory: initializeConfig,
    //   deps: [ConfigService],
    //   multi: true,
    // },
  ],
};
