import cors from "cors";
import express from "express";
import { z } from "zod";
import { env } from "./config.js";
import {
  executeWireTask,
  getCatalogBySlug,
  listCatalogs,
  listIdentities,
  listSessions,
  normalizeSessions,
  pollWireJob,
  searchActions,
  summarizeCatalogs,
} from "./services/anakin.js";
import { listBrowserDemos, runBrowserDemo } from "./services/browser-demos.js";
import { runBrowserAutomation } from "./services/browser-runner.js";
import { getSharedAutomation, saveSharedAutomation } from "./services/automation-store.js";
import { prepareAutomation as buildPlan } from "./services/planner.js";
import { presentAutomationResult } from "./services/result-presenter.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const runSchema = z.object({
  preparedAutomation: z.object({
    mode: z.enum(["wire", "browser"]),
    routeReason: z.string(),
    requiresSession: z.boolean(),
    sessionKind: z.enum(["none", "browser_session", "identity_credential"]),
    allowAnonymousBootstrap: z.boolean().optional(),
    paramFields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
      }),
    ),
    wire: z
      .object({
        actionId: z.string(),
        catalogSlug: z.string(),
        authRequired: z.boolean(),
        paramsSchema: z.record(z.any()),
      })
      .nullable()
      .optional(),
    browser: z
      .object({
        startUrl: z.string(),
        resultShape: z.enum(["text", "json"]),
        script: z.string(),
      })
      .nullable()
      .optional(),
  }),
  params: z.record(z.string()).default({}),
  sessionId: z.string().nullable().optional(),
  credentialId: z.string().nullable().optional(),
});

const shareSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  steps: z.string().min(1),
  preparedAutomation: runSchema.shape.preparedAutomation,
  preparedSignature: z.string().optional(),
  params: z.record(z.string()).default({}),
  createdAt: z.string().optional(),
});

app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok", model: env.GEMINI_MODEL, service: "autoflow-server" });
});

app.get("/api/catalogs", async (_req, res, next) => {
  try {
    const catalogs = await listCatalogs(env.ANAKIN_API_KEY);
    res.json({
      catalog: catalogs.catalog || [],
      summary: summarizeCatalogs(catalogs),
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/wire/catalog/:slug", async (req, res, next) => {
  try {
    const detail = await getCatalogBySlug(env.ANAKIN_API_KEY, req.params.slug);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

app.get("/api/wire/search", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.json({ results: [] });
      return;
    }
    const data = await searchActions(env.ANAKIN_API_KEY, q);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

app.get("/api/sessions", async (_req, res, next) => {
  try {
    const [sessionRes, identityRes] = await Promise.all([
      listSessions(env.ANAKIN_API_KEY),
      listIdentities(env.ANAKIN_API_KEY),
    ]);
    res.json({ sessions: normalizeSessions(sessionRes, identityRes) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/automations/prepare", async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1), steps: z.string().min(1) }).parse(req.body);
    const prepared = await buildPlan({
      geminiApiKey: env.GEMINI_API_KEY,
      anakinApiKey: env.ANAKIN_API_KEY,
      model: env.GEMINI_MODEL,
      name: body.name,
      steps: body.steps,
      searchActions,
    });
    res.json({
      ...prepared,
      meta: {
        displayMode: prepared.mode === "wire" ? "Structured action" : "Browser automation",
        editable: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/automations/run", async (req, res, next) => {
  try {
    const payload = runSchema.parse(req.body);
    const { preparedAutomation, params, sessionId, credentialId } = payload;

    if (preparedAutomation.mode === "wire") {
      const submitted = await executeWireTask(env.ANAKIN_API_KEY, {
        action_id: preparedAutomation.wire.actionId,
        ...(credentialId ? { credential_id: credentialId } : {}),
        params:
          preparedAutomation.wire.actionId === "yc_search_companies"
            ? { query: params.query || "", hits_per_page: 5, page: 0, sort: "relevance" }
            : params,
      });

      const completed = await pollWireJob(env.ANAKIN_API_KEY, submitted.job_id);
      if (completed.status === "failed") {
        throw new Error(completed.error?.message || "Wire execution failed.");
      }

      const meta = {
        mode: "wire",
        executionMs: completed.execution_ms || 0,
        creditsUsed: completed.credits_used || 0,
      };

      res.json({
        status: "completed",
        mode: "wire",
        result: completed.data,
        display: presentAutomationResult(completed.data, meta),
        rawText: null,
        meta,
      });
      return;
    }

    if (preparedAutomation.requiresSession && !sessionId) {
      throw new Error("This browser automation requires a saved session.");
    }

    const browserResult = await runBrowserAutomation({
      apiKey: env.ANAKIN_API_KEY,
      plan: preparedAutomation.browser,
      params,
      sessionId,
    });

    const normalizedBrowserResult = browserResult?.data ?? browserResult;
    const meta = { mode: "browser", executionMs: 0, creditsUsed: 0 };

    res.json({
      status: "completed",
      mode: "browser",
      result: normalizedBrowserResult,
      display: presentAutomationResult(normalizedBrowserResult, meta),
      rawText: typeof browserResult?.data === "string" ? browserResult.data : null,
      meta,
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/shared-automations", async (req, res, next) => {
  try {
    const body = shareSchema.parse(req.body);
    const saved = await saveSharedAutomation(env.AUTOMATION_STORE_FILE, body);
    res.json({
      automation: saved,
      shareId: saved.id,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/shared-automations/:id", async (req, res, next) => {
  try {
    const automation = await getSharedAutomation(env.AUTOMATION_STORE_FILE, req.params.id);
    if (!automation) {
      res.status(404).json({
        error: { message: "Shared automation not found", details: { id: req.params.id } },
      });
      return;
    }
    res.json({ automation });
  } catch (err) {
    next(err);
  }
});

app.get("/api/browser/demos", (_req, res) => {
  res.json({ demos: listBrowserDemos() });
});

app.post("/api/browser/demos/:id/run", async (req, res, next) => {
  try {
    const result = await runBrowserDemo(env.ANAKIN_API_KEY, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({
    error: { message: err.message || "Unexpected server error", details: err.details || null },
  });
});

app.listen(env.PORT, () => {
  console.log(`AutoFlow server listening on http://localhost:${env.PORT}`);
});
