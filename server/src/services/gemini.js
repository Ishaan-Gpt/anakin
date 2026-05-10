import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const paramFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(true),
  placeholder: z.string().default(""),
});

const looseParamFieldSchema = z.union([paramFieldSchema, z.string().min(1)]);

const plannerResponseSchema = z.object({
  mode: z.enum(["wire", "browser"]).default("browser"),
  routeReason: z.string().nullable().optional(),
  requiresSession: z.boolean().nullable().optional(),
  sessionKind: z.enum(["none", "browser_session", "identity_credential"]).nullable().optional(),
  paramFields: z.array(looseParamFieldSchema).nullable().optional(),
  actionId: z.string().nullable().optional(),
  catalogSlug: z.string().nullable().optional(),
  authRequired: z.boolean().nullable().optional(),
  paramsSchema: z.record(z.any()).nullable().optional(),
  startUrl: z.string().nullable().optional(),
  resultShape: z.enum(["text", "json"]).nullable().optional(),
  script: z.string().nullable().optional(),
  wire: z
    .object({
      actionId: z.string().min(1),
      catalogSlug: z.string().min(1),
      authRequired: z.boolean().nullable().optional(),
      paramsSchema: z.record(z.any()).nullable().optional(),
    })
    .nullable()
    .optional(),
  browser: z
    .object({
      startUrl: z.string().nullable().optional(),
      resultShape: z.enum(["text", "json"]).nullable().optional(),
      script: z.string().min(1),
    })
    .nullable()
    .optional(),
});

function plannerPrompt({ name, steps, actionCandidates }) {
  return `
You are planning an automation for a web app that routes tasks to Anakin.

Use only this decision rule:
1. Choose "wire" only if one candidate action is clearly suitable.
2. Otherwise choose "browser".

Rules:
- For browser mode, assume the backend already provides Playwright page and params.
- Browser scripts must be raw JavaScript snippet only.
- Do not include imports, requires, markdown, env access, process access, fs, or network libraries.
- The script must end by returning an object like:
  return { success: true, data: ... };
- Always return data in a human-readable structure. Prefer arrays of objects, key-value objects, and short summaries over opaque blobs.
- When extracting collections, use stable keys like title, name, summary, description, url, status, score, date, price, or category when they fit.
- Add paramFields whenever the task implies missing user input such as search terms, profile URLs, dates, emails, or company names.
- If no candidate action is a strong match, choose browser mode decisively.
- Prefer concise scripts using page.goto, page.waitForSelector, page.locator, page.fill, page.click, page.textContent, or page.evaluate.
- If auth is required in browser mode, use sessionKind "browser_session".
- If auth is required in wire mode, use sessionKind "identity_credential".

Return JSON only.

Task name:
${name}

Task steps:
${steps}

Candidate Wire actions:
${JSON.stringify(actionCandidates, null, 2)}
`;
}

function sanitizeScript(script) {
  return script
    .replace(/```(?:javascript)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function inferStartUrl(steps, script) {
  const scriptMatch = script.match(/page\.goto\(['"`]([^'"`]+)['"`]/);
  if (scriptMatch) {
    return scriptMatch[1];
  }

  const stepsMatch = steps.match(/https?:\/\/[^\s,)]+/i);
  if (stepsMatch) {
    return stepsMatch[0];
  }

  const domainMatch = steps.match(/\b([a-z0-9-]+\.(?:com|org|net|io|ai|co|dev|app))\b/i);
  if (domainMatch) {
    return `https://${domainMatch[1]}`;
  }

  return "https://example.com";
}

function inferResultShape(script) {
  return /return\s*\{\s*success:\s*true,\s*data:\s*\{/.test(script) ? "json" : "text";
}

function normalizeParamFields(fields) {
  return (fields || [])
    .map((field) => {
      if (typeof field === "string") {
        const trimmed = field.trim();
        if (!trimmed) {
          return null;
        }
        const name = trimmed
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
        return {
          name: name || "input",
          label: trimmed,
          required: true,
          placeholder: "",
        };
      }

      if (!field?.name || !field?.label) {
        return null;
      }

      return {
        name: field.name,
        label: field.label,
        required: field.required ?? true,
        placeholder: field.placeholder || "",
      };
    })
    .filter(Boolean);
}

function inferParamFields(name, steps, existingFields) {
  const normalizedExistingFields = normalizeParamFields(existingFields);
  if (normalizedExistingFields.length) {
    return normalizedExistingFields;
  }

  const text = `${name} ${steps}`.toLowerCase();
  const fields = [];

  if (/\b(search|find|look up|research|query|keyword)\b/.test(text)) {
    fields.push({
      name: "query",
      label: "Search query",
      required: true,
      placeholder: "What should this automation search for?",
    });
  }

  if (/\b(profile url|linkedin|website|url|page)\b/.test(text)) {
    fields.push({
      name: "target_url",
      label: "Target URL",
      required: true,
      placeholder: "https://example.com/page",
    });
  }

  if (/\b(email|recipient)\b/.test(text)) {
    fields.push({
      name: "email",
      label: "Email",
      required: true,
      placeholder: "name@example.com",
    });
  }

  return fields;
}

function normalizePlannerResponse(parsed, name, steps) {
  const mode = parsed.mode || "browser";
  const script = sanitizeScript(parsed.browser?.script || parsed.script || "");

  return {
    mode,
    routeReason:
      parsed.routeReason ||
      (mode === "wire"
        ? "Gemini matched this task to a Wire action candidate."
        : "Gemini selected Browser API because no high-confidence Wire action was required."),
    requiresSession: parsed.requiresSession ?? parsed.authRequired ?? false,
    sessionKind:
      parsed.sessionKind ||
      ((parsed.requiresSession ?? parsed.authRequired)
        ? mode === "wire"
          ? "identity_credential"
          : "browser_session"
        : "none"),
    paramFields: inferParamFields(name, steps, parsed.paramFields || []),
    wire:
      mode === "wire"
        ? {
            actionId: parsed.wire?.actionId || parsed.actionId || "",
            catalogSlug: parsed.wire?.catalogSlug || parsed.catalogSlug || "",
            authRequired: parsed.wire?.authRequired ?? parsed.authRequired ?? false,
            paramsSchema: parsed.wire?.paramsSchema || parsed.paramsSchema || {},
          }
        : null,
    browser:
      mode === "browser"
        ? {
            startUrl: parsed.browser?.startUrl || parsed.startUrl || inferStartUrl(steps, script),
            resultShape: parsed.browser?.resultShape || parsed.resultShape || inferResultShape(script),
            script,
          }
        : null,
  };
}

export async function planAutomation({ apiKey, model, name, steps, actionCandidates }) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: plannerPrompt({ name, steps, actionCandidates }),
    config: {
      responseMimeType: "application/json",
    },
  });

  const parsed = plannerResponseSchema.parse(JSON.parse(response.text));
  return normalizePlannerResponse(parsed, name, steps);
}
