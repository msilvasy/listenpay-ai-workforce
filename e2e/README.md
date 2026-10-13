# ListenPay end-to-end tests (Playwright)

Browser tests for every route in the portal: `/`, `/workspace`, `/programs`, `/industries`,
`/secure-documents` and `/legal`.

## Setup (once)

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run e2e            # builds the app, serves it with server.mjs on :4310, runs all tests
npm run e2e:ui         # interactive UI mode (watch, time-travel debugging)
npm run e2e:report     # open the last HTML report (traces/videos for failures)
npx playwright test e2e/workspace.spec.ts -g "history"   # one file / matching tests
```

If the app is already running, point the tests at it to skip the build:

```bash
# PowerShell
$env:E2E_BASE_URL="http://localhost:3000"; npm run e2e
# bash
E2E_BASE_URL=http://localhost:3000 npm run e2e
```

| Variable            | Default                           | Purpose                                     |
|---------------------|-----------------------------------|---------------------------------------------|
| `E2E_BASE_URL`      | (unset → build + serve on 4310)   | Test an already-running app                  |
| `E2E_PORT`          | `4310`                            | Port for the auto-started server             |
| `E2E_API_URL`       | `https://localhost:5001/api/`     | Must match `environment.listenPayUrl`        |
| `E2E_DASHBOARD_URL` | `http://localhost:4300/dashboard` | Must match `environment.dashboardUrl`        |

## The .NET API is mocked

`e2e/support/fixtures.ts` intercepts every call to `listenPayUrl` with `page.route`, so the
suite needs no API, database or OpenAI key. The mock covers `Account/auth`, `Account/{email}`
(create), `Account/Verify2FA` (accepts code `246810`), `RecommendedSignal`, `AI/Recommendation` and
`GuidanceResponse` (GET/POST/DELETE). Tests use the `api` fixture to change responses
(`api.set({ signals: 'error' })`) and to assert on what the app sent (`api.calls.savedResponses`).
`signIn(page)` seeds a valid-looking JWT so the signed-in (server history) paths run.

## Known bugs

Tests that call `knownBug('…')` document real defects and are *expected* to fail. When the bug
is fixed Playwright reports the test as "unexpectedly passed" — delete the `knownBug` line then.

None open. The four bugs this suite first found (× close button unclickable, saved light theme
not applied on reload, Continue button and signature panels ignoring `[hidden]`) are fixed and
now covered by regular tests.

## Projects

* `chromium` – the full suite (Desktop Chrome).
* `mobile` – Pixel 7 viewport, runs only tests tagged `@mobile`.
