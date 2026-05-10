# AutoFlow

AutoFlow is a no-code browser automation MVP built against Anakin's current public
docs. Gemini interprets a natural-language task, then the backend routes execution to
either:

- Anakin Wire / Holocron for supported site-specific actions
- Anakin Browser API for free-form Playwright browser automation

## Why this architecture

The original prompt assumed a frontend-only Claude + MCP flow. Anakin's live docs show
that generic browser execution is handled through the Browser API WebSocket, while Wire
handles prebuilt actions and MCP exposes a narrower tool surface. This implementation
uses the documented runtime path.

## Project layout

```text
client/   React + Vite frontend
server/   Express backend with Gemini + Anakin integrations
```

## Setup

1. Copy `.env.example` to `.env`
2. Set `ANAKIN_API_KEY` and `GEMINI_API_KEY`
3. Install dependencies:

```bash
npm install
```

4. Start both apps:

```bash
npm run dev
```

Frontend defaults to `http://localhost:5173`.
Backend defaults to `http://localhost:8787`.

## Available scripts

```bash
npm run dev
npm run dev:client
npm run dev:server
npm run build
npm run check
```

## Backend API

### `GET /api/health`

Returns service and environment status.

### `GET /api/catalogs`

Returns visible Anakin catalogs plus a capability summary.

### `GET /api/sessions`

Returns saved browser sessions and active Wire credentials normalized for the frontend.

### `POST /api/automations/prepare`

Input:

```json
{
  "name": "YC Idea Validator",
  "steps": "Go to ycombinator.com/companies, search for the given keyword, and return the top 5 matches"
}
```

### `POST /api/automations/run`

Runs a prepared automation in either Wire or Browser mode.

## Auth model

- Browser automations use Anakin saved sessions via `session_id`
- Wire actions use `credential_id` from Holocron identities
- The app does not store raw passwords or API secrets in the frontend

## Skill

This repo also creates a reusable Codex skill at:

`C:\Users\ISHAAN\.codex\skills\anakin-autoflow`
