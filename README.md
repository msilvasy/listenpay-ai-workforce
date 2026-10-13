# ListenPay Technical White Paper: Architecture, Patterns & Frameworks

Oct 13, 2026 · @The GPaw

## Executive summary

ListenPay pays employees to complete short learning content (YouTube video now, Spotify audio next) and tracks every second watched against a per-company catalog. It runs as two codebases: **ListenPay2027**, an Angular 20 single-page app, and **ListenPayAPI2026**, an ASP.NET Core API on .NET 10 backed by SQL Server through Entity Framework Core.

The stack fits the product. ListenPay is a multi-tenant, money-handling, compliance-adjacent system (CME, OSHA, HIPAA copy appears in the UI), and both halves are typed end to end, dependency-injected and layered the same way. The front end is lean: 9 runtime packages, standalone components, signals for state and no UI kit. The API follows a classic Controller → Service interface → Service → DbContext layering with one response envelope for every action.

Three findings need action before the next release, ahead of any refactoring:

1. **Production secrets are committed** in `appsettings.json` (JWT signing key, database connection string, Spotify client secret, OpenAI key, SMTP password), and a `pub-xml-pwd.txt` file sits in the repo root.
2. **The earnings endpoint is unauthenticated.** `POST account/{email}/activity` credits money to whatever email is in the URL, with no token check.
3. **Earnings are over-credited.** Each play or pause event pays 0.1 × the current playback position, so one video paused three times is paid three times over.

The Risks section lists these with fixes. The rest of this paper explains how the parts fit together and why each choice was made.

Scope: source as of 2026-10-13 in `source/repos/ListenPay2027` and `source/repos/ListenPayAPI2026`. Secret values were not copied into this paper.

## System architecture

ListenPay is a three-tier system: an Angular SPA in the browser, a stateless .NET API, and SQL Server. The Dashboard Suite issues the identity, the UI plays video directly from YouTube, and only the API touches the database or the Spotify, OpenAI and mail services.

&#91;embedded content: runtime architecture · 7 parts\]

The browser never holds a Spotify, OpenAI or database secret: those stay on the API, and the UI carries only the user's JWT. YouTube playback goes straight from the browser to Google, so the API carries no video traffic, only the small activity and watch-time posts.

## UI: ListenPay2027 (Angular 20)

The UI is a standalone-component Angular 20.3 app with no NgModules, built by the esbuild-based `@angular/build:application` builder and served on port 4300. It depends on only nine runtime packages: the Angular core set, RxJS 7.8, tslib and zone.js.

### File structure

```text
ListenPay2027/
├─ angular.json            build, dev server :4300, budgets (500 kB warn / 1 MB error)
├─ package.json            Angular 20.3, TypeScript 5.9, RxJS 7.8
└─ src/
   ├─ main.ts              bootstrapApplication(App, appConfig)
   ├─ styles.css           global design system (42 kB)
   ├─ industry-themes.css  Healthcare / Industrial / Commercial palettes
   ├─ category-icons.css
   ├─ assets/images/       category icons (icon-sm-*, icon-w-*), backgrounds, banners
   └─ app/
      ├─ app.config.ts       providers: router, HttpClient + interceptor, app initializer
      ├─ app.routes.ts       12 routes, all rendered by PortalPage
      ├─ app.settings.ts     per-environment URLs (Suite, API, assets, YouTube API)
      ├─ industry.ts         industry profiles: theme, copy, imagery
      ├─ theme.service.ts    applies data-theme to <html>
      ├─ auth/
      │  ├─ session.service.ts  JWT + industry hand-off, claims as signals
      │  └─ auth.interceptor.ts adds Bearer token to API calls only
      ├─ listenpay/
      │  ├─ listenpay.models.ts           API contracts (ApiEnvelope<T>, categories, videos)
      │  ├─ listenpay-content.service.ts  API facade: categories, videos, activity, watch time
      │  └─ youtube-iframe-api.service.ts loads the YouTube IFrame API once
      ├─ components/
      │  ├─ category-videos/     video list, progress, tracking
      │  ├─ video-player-modal/  YouTube player, emits play/pause/complete
      │  ├─ content-row/
      │  └─ login-modal/
      ├─ pages/portal-page/     the routed shell for every page
      └─ data/, mock-portal-api.service.ts  mock summary, analytics, earnings
```

The folders split by responsibility: `auth/` owns identity, `listenpay/` owns everything that talks to the ListenPay API or YouTube, `components/` holds reusable UI and `pages/` holds the routed shell. A new data source lands in `listenpay/` without touching any component.

### Frameworks and why

| Technology | Where | Why it suits ListenPay |
| --- | --- | --- |
| Angular 20 standalone components | whole app | Strong conventions for a long-lived enterprise portal; DI and typed services mirror the .NET API, so one team can work both sides |
| Signals (`signal`, `computed`, `effect`, `input`, `output`) | services and components | Session, theme, balance and video state are synchronous values; signals update only what depends on them, without subscription bookkeeping |
| RxJS 7.8 | HTTP layer | HTTP is asynchronous and cancellable; `switchMap` drops stale category loads when the route changes, `shareReplay` dedupes requests |
| Functional interceptor (`HttpInterceptorFn`) | `auth.interceptor.ts` | Adds the JWT only to URLs under `apiUrl`, so the token never reaches YouTube or other hosts |
| `provideAppInitializer` | `app.config.ts` | Reads the token from the URL before the router runs, then scrubs it from history |
| YouTube IFrame Player API, loaded directly | `youtube-iframe-api.service.ts` | Gives the play, pause and end events that drive earnings, with no extra npm dependency |
| CSS custom properties + `data-theme` | `industry-themes.css`, `ThemeService` | One codebase serves Health Care, Industrial and Commercial customers by swapping a single attribute |
| esbuild application builder | `angular.json` | Fast builds and size budgets enforced at build time |

### Design patterns

- **Facade.** `ListenPayContentService` is the only class that knows API URLs, query parameters and the response envelope. Components ask for `getParentCategories()` or `recordActivity()` and never see HTTP.
- **Adapter.** The `unwrap()` operator turns the API's `ResponseModel<T>` into plain data: OK returns `dataSet`, NoDataFound returns an empty list, anything else throws.
- **Request cache with error eviction.** Each read is wrapped in `shareReplay(1)`; a failed request deletes its cache entry, so the next call retries instead of replaying the error.
- **Container and presentational components.** `PortalPage` reads the route and loads data; `CategoryVideos` and `VideoPlayerModal` take inputs and emit events. The modal knows nothing about earnings, it only reports `playStarted`, `playStopped` and `videoComplete`.
- **Configuration object (strategy by data).** `INDUSTRIES` maps each industry id to its theme, copy, banner and compliance link. Adding a fourth industry is one entry plus one CSS block.
- **Lazy singleton loader.** `YouTubeIframeApiService.load()` injects the script once and shares a single Promise across every player.
- **Loadable state.** `loadable()` turns any Observable into `{state: loading | ready | error, data}` so every tile grid renders the same loading, error and retry UI.
- **Graceful degradation.** Without a valid JWT the dashboard falls back to mock tiles from `MockPortalApiService`, so the portal still demos offline.

## API: ListenPayAPI2026 (ASP.NET Core, .NET 10)

The API is a three-project .NET 10 solution: a web host, a data project and a shared-types project. Each request runs Controller → service interface → service → `ListenPayDbContext` → SQL Server, and every action answers with the same `ResponseModel<T>` envelope.

### File structure

```text
ListenPayAPI2026/
├─ ListenPay.sln
├─ azure-pipelines.yml          restore → build → publish → zip (self-hosted agent)
├─ documentation/               SQL: schema, seeds, RBAC, icon updates
├─ ListenPay.Common/            enums shared by all projects (ActivityType, RoleIdType)
├─ ListenPay.Data/
│  ├─ ListenPayDbContext.cs      29 DbSets, relationships, indexes
│  ├─ Entities/                  BaseEntity + one class per table
│  └─ Migrations/                EF Core code-first migrations
└─ ListenPay.WebApi/
   ├─ Program.cs                 DI, JWT, CORS, Serilog, Swagger, pipeline, migrate on start
   ├─ Controllers/               15 controllers (Account, ActivityLog, YouTubeCategory,
   │                             YouTubeVideo, Spotify, GuidanceResponse, AI, …)
   ├─ IService/                  service interfaces
   ├─ Services/                  business logic (UserService, ActivityLogService, …)
   ├─ BindingModels/             request DTOs
   ├─ Models/, ResponseModel/    response DTOs, ResponseModel<T>
   ├─ Helpers/                   AppRoles, StrictQuery filter, InputValidation, JWT helpers
   ├─ Handlers/                  SpotifyHeaderHandler (outbound HTTP)
   └─ wwwroot/                   uploaded category images, static files
```

### Frameworks and why

| Technology | Version in csproj | Why it suits ListenPay |
| --- | --- | --- |
| ASP.NET Core Web API | .NET 10 (`net10.0`) | High-throughput, typed, long-term-supported runtime; first-class on Azure, where the pipeline already deploys |
| Entity Framework Core + SQL Server | 6.0.1 | Earnings are a ledger: transactions, foreign keys and indexes matter more than schema flexibility. Code-first migrations version the schema with the code |
| JWT bearer authentication | JwtBearer 6.0.1 | Stateless tokens let the Dashboard Suite, ListenPay2027 and the admin app share one sign-in; claims carry user, company and role |
| Policy-based authorization | built-in | The Guidance RBAC uses a named policy plus a role-permission table, cached with `IMemoryCache` |
| Serilog | 6.0 + File + MSSqlServer sinks | Structured request logs to console, rolling files and a SQL table for audit |
| Swashbuckle (OpenAPI) | 6.3.0 | Live API docs with a Bearer box, used by the front-end teams |
| Typed `HttpClient` + `DelegatingHandler` | built-in | `SpotifyService` gets a configured client; `SpotifyHeaderHandler` adds the auth header in one place |
| Newtonsoft.Json | 6.0.1 | Ignores reference loops in EF navigation graphs |
| Azure Pipelines | `azure-pipelines.yml` | Builds on every push to `main` and publishes a deployable zip |

### Design patterns

- **Layered architecture.** Controllers only translate HTTP; services hold the rules (earning rates, watch-time max); the DbContext is the data layer.
- **Interface-based dependency injection.** Every service is registered against an interface in `Program.cs` (`IYoutubeVideoCategory` → `YouTubeCategoryService`), scoped per request, so services can be swapped or mocked.
- **Unit of Work through DbContext.** EF Core's `DbContext` acts as the repository and unit of work; there is no extra repository layer, which keeps queries readable for a team this size.
- **Response envelope.** `ResponseModel<T>` carries `responseCode` (1 OK, 2 Error, 4 NoDataFound, 401) plus `dataSet`, so every client handles errors one way. The UI's `unwrap()` is the matching adapter.
- **Options pattern.** `JwtSettings`, `SpotifyOptions` and `SMTPOption` bind from configuration sections.
- **Base entity for auditing.** `BaseEntity` adds created/modified date and user to every table.
- **Self-referencing hierarchy.** `YouTubeVideoCategory.ParentId` turns one table into parent and child categories.
- **Action filters.** `StrictQueryAttribute` allow-lists query parameters, blocks parameter pollution and caps query length before the action runs.
- **Fail-closed RBAC.** `AppRoles.Normalize` returns null for unknown roles, so a misspelled role grants nothing.

## Key flows

### Browsing categories

The user drills down three levels; each level is one route rendered by `PortalPage` and one API call, cached in the content service.

1. `/dashboard` shows parent category tiles from `GET YouTubeCategory/GetParentYouTubeCategoriesByCompanyId`. Without a valid JWT it shows the mock tiles instead.
2. `/programs/:parentId` shows that parent's child tiles from `GET YouTubeCategory/GetYTCategoriesByCompanyAndCatId`. Each child has its own icon from `YouTubeVideoCategory.IconUrl`.
3. `/programs/:parentId/:childId` shows the videos from `GET YouTubeVideo/GetYouTubeVideosByCompanyAndUserId`, filtered in the browser by `relatedCategories`, each with its watched percentage.
4. Clicking a video opens `VideoPlayerModal`, which loads the YouTube IFrame API once and starts playback.

### Watching a video and earning

Earnings are driven by player events, not by a timer: the modal reports state changes, `CategoryVideos` turns each one into two API calls, and the list re-reads progress from the server.

&#91;embedded content: watch tracking sequence · 5 parts, 10 messages\]

The activity call writes one `ActivityLog` row per event with `Earned = 0.1 × playback position in seconds` and adds it to `UserInformation.Earned`. The watch-time call keeps only the furthest position per user and video, which is the right rule; the activity call does not, which causes Risk 3. Closing the modal while a video plays is recorded as a pause, so the last position is never lost.

## Data model

The schema is multi-tenant by column: each core table carries `CompanyId`, and categories form a two-level tree in one self-referencing table. Earnings are stored twice on purpose: as a running balance on `UserInformation.Earned`, and as one `ActivityLog` row per event with the balance before and after, so any balance can be rebuilt from the ledger.

&#91;embedded content: core data model · 7 tables\]

All entities inherit `BaseEntity` (created and modified date and user). `UserRelatedVideoData` (not drawn) keeps one row per user, video and day for daily reporting. The full schema, 29 `DbSet`s including Spotify, B2B, Guidance and Recommended Signals tables, is in `documentation/lstnpy-sql-schema.sql`.

## Security, identity and configuration

Identity flows one way: the ListenPay AI Dashboard Suite signs the user in, then opens ListenPay2027 with `?industry=<id>#access_token=<jwt>`. The UI reads both before routing, stores the token in `sessionStorage` (cleared when the tab closes), and removes it from the address bar with `history.replaceState`. Putting the token in the URL fragment matters: browsers never send the fragment to a server, so it does not land in proxy or server logs.

| Claim | Used as | Read by |
| --- | --- | --- |
| `lp_uid` | UserInformationId | UI `SessionService.userId`, API `AppClaims.UserId` |
| `CompanyId` | tenant id (text before any `-`) | UI `SessionService.companyId`, API |
| `email` | key for `account/{email}/activity` | UI `SessionService.email` |
| `role` | LSTNPY-Admin, Licensee-Admin, Subscriber/User | API Guidance RBAC |
| `exp` | expiry | UI drops expired tokens; API `ValidateLifetime` |

**What is done well**

- The UI only decodes the JWT to decide whether to use it; the API verifies the signature, issuer, audience and lifetime on every request.
- The interceptor attaches the token only to URLs under `apiUrl`.
- The Guidance endpoints use a real policy, a role-permission table and data scopes (own, company, all).
- `StrictQueryAttribute` and `InputValidation` follow OWASP guidance on parameter allow-lists and uniform errors.
- CORS is an explicit origin list (localhost dev ports, `listenpay.app`, `www.listenpay.site`), not `AllowAnyOrigin`.

**Gaps** (detail and fixes in the Risks section)

- Secrets live in `appsettings.json` in Git, not in user-secrets, environment variables or Azure Key Vault.
- `AccountController` has no `[Authorize]` on `activity`, `auth/{email}`, `{email}/{pwd}/existing` or `AddUserRedeem`.
- Most `[Authorize]` actions take `companyId` and `userId` from the query string and never compare them to the token's claims, so any signed-in user can read another tenant's data.
- The project defines its own global `AuthorizeAttribute` that only checks `IsAuthenticated`; it shadows the framework attribute (the Guidance controller has to fully qualify the real one). `JwtMiddleware` exists but is never registered.
- `RequireHttpsMetadata = false`, and tokens last 4,060 minutes (about 2.8 days).
- Configuration for the UI is a TypeScript constant (`app.settings.ts`) pointing at `localhost`; it needs per-environment files before deployment.

## Why this stack fits ListenPay

ListenPay's requirements decide the stack more than taste does: it moves money, serves several companies from one database, sells into regulated industries, and is built by a small team that works on both ends. Angular plus ASP.NET Core plus SQL Server matches each of those.

| ListenPay requirement | Choice | Why it wins | Alternative considered | Why not |
| --- | --- | --- | --- | --- |
| Earnings must add up exactly | SQL Server + EF Core, `decimal` columns, `ActivityLog` with Old/Earned/Current | ACID transactions and a running ledger per activity | Document DB (Cosmos, Mongo) | Balances need multi-row transactions and joins across users, videos and companies |
| Many companies, one deployment | `CompanyId` on every table, claim in the JWT | One schema, tenant filter per query, cheap to onboard a company | Database per tenant | More ops cost than a team this size can carry today |
| Regulated buyers (health care, industrial) | .NET LTS, Serilog to SQL, RBAC tables | Mature security libraries, audit trail in the database, Azure compliance | Node/Express | Works, but auth, validation and logging would be hand-assembled from many packages |
| One team on UI and API | Angular + ASP.NET Core | Same ideas both sides: DI, typed services, interfaces, decorators | React (a `ListenPay2027-react` folder exists) | React leaves routing, DI, forms and HTTP to separate libraries; Angular ships them, which reduces decisions and drift |
| Three industry brands, one app | CSS variables + `data-theme` + `INDUSTRIES` config | A customer's theme is data, not a fork | Separate builds per industry | Triples release work |
| Earn on real viewing | YouTube IFrame API events | Exact play, pause and end positions | Embed iframe only | No events, so no tracking |
| Small bundle on phones | Standalone components, no UI kit, 500 kB budget | Fast first load for shift workers on mobile data | Angular Material / Bootstrap JS | Heavier for a mostly custom design |
| Ship often | Azure Pipelines, EF migrations | Schema and code release together | Manual SQL scripts only | Drift between environments |

The choices are not the only workable ones, but each alternative would add either operational cost or integration work without serving a ListenPay requirement better.

**Where the stack is under-used today.** The API targets .NET 10 but pins ASP.NET and EF Core packages at 6.0.x (out of Microsoft support since November 2024), Swashbuckle 6.3, `Microsoft.AspNetCore.StaticFiles` 2.2.0 and `Microsoft.Data.SqlClient` 2.1.7. Upgrading them to the 10.x line brings security fixes, better EF query translation and the built-in OpenAPI generator. The UI ships with test generation switched off (`skipTests: true`) and has no test runner configured, so neither half has automated tests yet.

## Risks and recommendations

The first three items are release blockers: two let anyone add money to an account, and one exposes the keys that sign every token.

| # | Severity | Finding | Where | Fix |
| --- | --- | --- | --- | --- |
| 1 | Critical | Secrets committed: JWT signing key, DB connection string, Spotify client secret, OpenAI key, SMTP password; `pub-xml-pwd.txt` in repo root | `ListenPay.WebApi/appsettings.json`, repo root | Rotate every key now; move to Azure Key Vault or environment variables; purge from Git history; add `appsettings.*.json` secrets to `.gitignore` |
| 2 | Critical | Earnings endpoint has no auth; any caller can credit any email | `AccountController.Activity` (`POST account/{email}/activity`) | Require the JWT; take user and company from claims, not the URL or body |
| 3 | Critical | Each play/pause pays 0.1 × current position, so pausing at 60 s then 120 s pays 6 + 12 = 18 for 120 s watched | `UserService.AddActivity` | Pay only the delta since the last recorded position per user and video, capped at video length; enforce it server-side |
| 4 | High | Password sent in the URL path, which Serilog request logging records | `GET account/{email}/{pwd}/existing` | Replace with a POST body; hash passwords: `UserService.GetByEmailPwd` compares `CurrentPassword == pwd`, so they are stored in plain text |
| 5 | High | Cross-tenant reads: `companyId` and `userId` come from the query string, not the token | `YouTubeVideo`, `YouTubeCategory`, `ActivityLog` controllers | Read ids from claims; reject requests whose ids do not match |
| 6 | High | Category delete has no tenant check: `x.CompanyId == x.CompanyId` is always true | `YouTubeCategoryService.DeleteCompanyRelatedYouTubeVideoCategory` | Compare to the caller's `CompanyId` claim |
| 7 | High | ASP.NET, EF Core and JwtBearer packages at 6.0.x on a .NET 10 target | `*.csproj` | Upgrade to 10.x; remove `Microsoft.AspNetCore.StaticFiles` 2.2.0 and `CodeGeneration.Design` 3.1.2 |
| 8 | Medium | Image upload writes base64 to `wwwroot` with random-number names and no type or size check | `AddUpdateYouTubeVideoCategory` | Validate MIME and size; store in Blob Storage with GUID names |
| 9 | Medium | Custom global `AuthorizeAttribute` shadows the framework one; `JwtMiddleware` is dead code | `Helpers/` | Delete both; use `[Microsoft.AspNetCore.Authorization.Authorize]` with policies everywhere |
| 10 | Medium | Migrations run at app start | `Program.ApplyDatabaseMigrations` | Run migrations as a pipeline step so a failed migration does not take the API down |
| 11 | Medium | No automated tests in either codebase | both | Start with service tests for earnings and watch time, then UI tests for `ListenPayContentService` |
| 12 | Low | Login modal accepts any input and closes; summary, analytics and earnings are mock data; Spotify not ported; README describes Angular 14 | ListenPay2027 | Remove or wire the modal to the API; replace mocks; refresh README |

Suggested order: rotate secrets and lock down `account/*` this week (items 1–4), fix tenant checks next (5–6), then plan the package upgrade with tests around earnings (7, 11) so the upgrade can be verified.
