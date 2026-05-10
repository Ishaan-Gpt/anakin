# MASTER PROMPT PLAN - AutoFlow
## Corrected execution sequence for real Anakin docs

---

## Before You Start

Have these ready:

- [ ] `ANAKIN_API_KEY`
- [ ] `GEMINI_API_KEY`
- [ ] At least one saved browser session or one usable Wire credential if you want to
      demo authenticated automations

Do not assume Anakin MCP is the main browser runtime. Use official docs only.

---

## Prompt 1 - Capability Probe

Fire this first.

```text
I am building with Anakin's official APIs and Gemini.

Task:
1. Write a minimal Node.js capability probe
2. Verify GEMINI_API_KEY by calling Gemini 2.5 Flash
3. Verify ANAKIN_API_KEY by:
   - listing Holocron catalogs
   - listing identities
   - listing browser sessions
4. Attempt a minimal Browser API connection to:
   wss://api.anakin.io/v1/browser-connect
5. Log a concise capability summary:
   - Gemini OK or failed
   - Holocron OK or failed
   - Sessions available count
   - Identities available count
   - Browser API connect OK or failed

Use only Anakin official docs.
Do not use Claude or MCP as the main runtime.
```

What to check:

- Gemini request succeeds
- `GET /v1/holocron/catalog` succeeds
- `GET /v1/holocron/identities` succeeds
- `GET /v1/sessions` succeeds
- Browser API CDP connection succeeds

---

## Prompt 2 - Backend Setup

```text
Capability probe passed. Build the backend first.

Read MASTER_CONTEXT_V2.md fully.

Build a minimal Node backend that:

1. Keeps ANAKIN_API_KEY and GEMINI_API_KEY server-side
2. Exposes:
   - POST /api/automations/prepare
   - POST /api/automations/run
   - GET /api/catalogs
   - GET /api/sessions
   - GET /api/health
3. Uses Gemini to:
   - extract params
   - choose wire vs browser
   - generate a constrained Playwright snippet when browser mode is needed
4. Uses Holocron to:
   - list/search actions
   - execute tasks
   - poll job results
5. Uses Browser API + Playwright to:
   - connect to wss://api.anakin.io/v1/browser-connect
   - optionally attach session_id
   - run the generated script
   - return normalized results

No secrets in the frontend.
No fake data.
Use official Anakin docs only.
```

---

## Prompt 3 - Frontend Studio

```text
The backend exists. Build the frontend.

Read MASTER_CONTEXT_V2.md fully.

Build a React app with:

Landing page:
- headline: Automate anything. Share with anyone.
- CTA: Get Started

Studio:
- sidebar with Build and Library
- Build view:
  - automation name input
  - steps textarea
  - Generate & Run button
  - dynamic param fields from /prepare
  - session or credential selector when needed
  - result panel
  - Save & Share button
- Library view:
  - 3 prebuilt automation cards
  - saved automations list from localStorage

Use the backend APIs only.
Do not put API keys into App.jsx.
```

---

## Prompt 4 - Wire-First Routing

```text
Strengthen prepare-time routing.

Rules:
1. Search Holocron actions first
2. If a confident supported action exists, use mode=wire
3. If not, use mode=browser
4. Surface routeReason in the response
5. If the chosen action requires auth, require a credential_id from identities

Use real catalog/action schemas from Anakin.
```

---

## Prompt 5 - Browser Fallback

```text
Improve browser fallback mode.

Requirements:
1. Gemini must return a constrained Playwright snippet only
2. Script must use existing page + params variables
3. No imports, no requires, no env access
4. Return:
   { success: true, data: ... }
5. Validate the plan before execution
6. If session is required, block execution until a saved session is selected
```

---

## Prompt 6 - Saved Session Flow

```text
Implement the auth flow around Anakin sessions and identities.

Requirements:
1. GET /api/sessions returns:
   - browser sessions
   - active identity credentials
2. Build view shows selectors instead of email/password inputs when auth is needed
3. Gemini Key and LinkedIn flows can require a saved session or credential
4. Do not persist secrets or passwords in localStorage
```

---

## Prompt 7 - Share and Load

```text
Implement the complete share/load flow.

Save:
- id = Date.now().toString(36)
- localStorage key: autoflow_${id}
- save:
  { id, name, steps, mode, preparedAutomation, paramFields, createdAt, runCount }
- build URL from current origin + pathname + ?id=
- copy to clipboard

Load:
- on app start, if ?id= exists:
  - load from localStorage
  - restore Build view
  - show loaded banner
  - let the user provide current params/session and run
```

---

## Prompt 8 - Polish

```text
Final polish only.

1. Loading states
2. Error states
3. Better result formatting for string vs JSON
4. Empty state for saved automations
5. Keep the architecture unchanged
```

---

## Demo Order

```text
1. Open landing page
2. Enter Studio
3. Show Library cards
4. Run YC validator in browser mode
5. Show a Wire-capable action if available from Anakin
6. Save & Share
7. Open the shared URL
8. Explain that auth-required runs use saved Anakin sessions or credentials
```
