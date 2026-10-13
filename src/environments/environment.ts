// Base URL for the ListenPay .NET API. Adjust per environment as needed —
// for a production build, point this at your deployed API's base URL
// (and consider splitting this into environment.development.ts /
// environment.production.ts with Angular CLI file replacements if you need
// different values per build configuration).
export const environment = {
  production: false,
  //listenPayUrl: 'https://listenpay.online/api/',
  listenPayUrl: 'https://localhost:5001/api/',
  // ListenPay Programs (ListenPay2027 Angular app). The selected industry is appended as
  // ?industry=<id> and the signed-in JWT as #access_token=<jwt>; the app themes itself per industry.
  dashboardUrl: 'http://localhost:4300/dashboard',
};

