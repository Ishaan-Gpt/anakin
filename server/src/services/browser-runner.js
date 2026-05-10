import { chromium } from "playwright-core";

const FORBIDDEN_SCRIPT_PATTERNS = [
  /\bimport\s+/,
  /\brequire\s*\(/,
  /\bprocess\./,
  /\bfs\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bchild_process\b/,
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function assertSafeScript(script) {
  for (const pattern of FORBIDDEN_SCRIPT_PATTERNS) {
    if (pattern.test(script)) {
      throw new Error("Generated browser script contains a forbidden construct.");
    }
  }
}

function buildBrowserConnectUrl(sessionId) {
  const url = new URL("wss://api.anakin.io/v1/browser-connect");
  const country = process.env.ANAKIN_BROWSER_COUNTRY || "US";
  if (country) {
    url.searchParams.set("country", country);
  }
  if (sessionId) {
    url.searchParams.set("session_id", sessionId);
  }
  return url.toString();
}

export async function runBrowserAutomation({ apiKey, plan, params, sessionId }) {
  assertSafeScript(plan.script);

  const connectUrl = buildBrowserConnectUrl(sessionId);

  const browser = await chromium.connectOverCDP(connectUrl, {
    headers: {
      "X-API-Key": apiKey,
    },
  });

  try {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    const runner = new AsyncFunction("page", "params", plan.script);
    const result = await runner(page, params);
    return result;
  } finally {
    await browser.close();
  }
}
