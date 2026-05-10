import { chromium } from "playwright-core";
import { env } from "./config.js";
import { listCatalogs, listIdentities, listSessions } from "./services/anakin.js";
import { GoogleGenAI } from "@google/genai";

async function checkGemini() {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: "Reply with OK",
  });
  return response.text.trim();
}

async function checkBrowserConnect() {
  const browser = await chromium.connectOverCDP("wss://api.anakin.io/v1/browser-connect", {
    headers: {
      "X-API-Key": env.ANAKIN_API_KEY,
    },
  });

  try {
    return browser.version();
  } finally {
    await browser.close();
  }
}

async function main() {
  const [gemini, catalogs, identities, sessions, browserVersion] = await Promise.all([
    checkGemini(),
    listCatalogs(env.ANAKIN_API_KEY),
    listIdentities(env.ANAKIN_API_KEY),
    listSessions(env.ANAKIN_API_KEY),
    checkBrowserConnect(),
  ]);

  console.log(
    JSON.stringify(
      {
        gemini,
        catalogCount: (catalogs.catalog || []).length,
        identityCount: (identities.identities || []).length,
        sessionCount: (sessions.sessions || []).length,
        browserVersion,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
