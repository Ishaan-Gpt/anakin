# MASTER CONTEXT - AutoFlow
## Anakin Hackathon | Real Anakin APIs | Gemini Planner

---

## What We're Building

A no-code browser automation platform grounded in Anakin's current public docs.

User describes a task in plain English -> Gemini interprets it -> backend routes it to
either an Anakin Wire action or the Anakin Browser API -> result is returned -> the
automation is saved and shareable by URL.

---

## Core Concept

Most browser tasks are repetitive. Nobody should do them twice.
AutoFlow lets anyone describe a task once, run it again, and share the setup with
other users.

No code. No local browser setup. Just task instructions plus reusable sessions when
authentication is needed.

---

## Corrected Architecture

### Primary execution path

```text
User types steps
      |
React frontend
      |
Minimal Node backend
      |
Gemini planner/router
      |
Decision: Wire action or Browser API
      |
Anakin executes
      |
Result normalized and returned to frontend
```

### Why not MCP-first?

The current Anakin docs show these MCP tools:

- `scrape`
- `search`
- `map`
- `crawl`
- `agentic_search`
- `wire_action`

That MCP surface is useful for agent tooling, but it is not the same as a general
"remote browser Claude can freely drive" architecture. For generic browser automation,
the documented path is the Browser API WebSocket:

- `wss://api.anakin.io/v1/browser-connect`

Use that from a backend with Playwright or Puppeteer.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite |
| Planner | Gemini API |
| Generic execution | Anakin Browser API via Playwright `connectOverCDP` |
| Site-specific execution | Anakin Wire / Holocron |
| Local persistence | `localStorage` |
| Backend | Minimal Node + Express |

---

## Real API Surface

### Gemini API

- SDK: `@google/genai`
- Default model: `gemini-3.1-flash-lite`
- Role in this app:
  - infer task intent
  - extract parameters
  - choose `wire` vs `browser`
  - generate constrained Playwright snippets for browser runs
  - summarize the final result

### Anakin Browser API

- Endpoint: `wss://api.anakin.io/v1/browser-connect`
- Auth: `X-API-Key` header
- Supports:
  - Playwright `connectOverCDP`
  - Puppeteer `browser.connect`
  - saved sessions using `?session_id=` or `?session_name=`

### Anakin Browser Sessions

- List sessions: `GET /v1/sessions`
- Save sessions when disconnecting Browser API with `?save_session=...`
- Use sessions for authenticated pages instead of repeatedly asking users for passwords

### Anakin Wire / Holocron

- List catalogs: `GET /v1/holocron/catalog`
- Get one catalog: `GET /v1/holocron/catalog/{slug}`
- Search actions: `GET /v1/holocron/search`
- List identities: `GET /v1/holocron/identities`
- Execute action: `POST /v1/holocron/task`
- Poll job: `GET /v1/holocron/jobs/{id}`

Use Wire when the task matches a supported prebuilt website action.

---

## Security Constraints

These keys must stay server-side:

- `ANAKIN_API_KEY`
- `GEMINI_API_KEY`

Do not inject them into the frontend.
Do not hardcode them in `App.jsx`.

Because Anakin Browser API uses a backend Playwright connection and API keys, the MVP
cannot be a safe frontend-only app.

---

## Routing Strategy

### Prefer Wire first

If Anakin already exposes a matching action:

- use the Wire action
- validate params against the action schema
- use `credential_id` when `auth_required: true`

### Fallback to Browser API

If no suitable Wire action exists:

- use Gemini to generate a constrained Playwright snippet
- run it through Browser API
- attach a saved `session_id` when the target site requires auth

---

## Auth Model

Default to saved sessions and Anakin identities.

### Browser auth

Use Anakin browser sessions for sites like Google or LinkedIn when browser interaction
is required.

### Wire auth

Use `credential_id` from `GET /v1/holocron/identities` for auth-required actions.

### Non-goal

Do not design the MVP around storing or repeatedly collecting user passwords in the app.

---

## Data Flow Detail

### Build an automation

1. User enters a name and plain-English steps
2. Frontend calls backend `POST /api/automations/prepare`
3. Backend:
   - searches Anakin Wire actions
   - asks Gemini to select `wire` or `browser`
   - extracts param fields
4. Frontend renders required params and session selector if needed
5. User clicks Run
6. Backend executes:
   - Wire task via Holocron, or
   - Browser script via Browser API
7. Result is returned and displayed
8. Automation metadata is saved to `localStorage`
9. Share URL is generated with `?id=...`

### Run a saved automation

1. User opens a shared URL with `?id=xyz`
2. App loads automation metadata from `localStorage`
3. Build view is pre-populated
4. User selects a session if needed
5. User runs the same prepared automation through the backend

---

## Automation Data Model

```json
{
  "id": "string",
  "name": "string",
  "steps": "string",
  "mode": "wire | browser",
  "preparedAutomation": {},
  "paramFields": ["string"],
  "createdAt": "ISO string",
  "runCount": 0
}
```

---

## Pre-Built Automations

### 1. Gemini API Key Fetcher

```text
Name: Get Gemini API Key
Steps: Open Google AI Studio, navigate to API keys, create a new key, and return it
Mode: browser
Auth: requires a saved Google session
Expected result: API key string
```

### 2. YC Idea Validator

```text
Name: YC Idea Validator
Steps: Go to ycombinator.com/companies, search for the given keyword, and return the
       top 5 company names with one-line descriptions
Mode: browser
Params: idea
Expected result: list of 5 companies
```

### 3. LinkedIn Profile Scraper

```text
Name: LinkedIn Profile Scraper
Steps: Retrieve a public or authenticated LinkedIn profile's name, headline,
       current company, and location
Mode: prefer wire if Anakin exposes a matching action; otherwise browser
Params: profileUrl
Auth: may require saved session or LinkedIn credential
Expected result: structured profile object
```

---

## What Not To Build

- No user accounts
- No payments
- No database for MVP
- No frontend-only secret handling
- No assumption that Anakin MCP is the browser runtime

---

## Build Targets

```text
client/src/App.jsx
client/src/main.jsx
client/src/styles.css
server/src/*
README.md
.env.example
```

Also create a reusable Codex skill for future Anakin work.
