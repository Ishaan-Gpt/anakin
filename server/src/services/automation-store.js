import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";

const storedAutomationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.string().min(1),
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
  preparedSignature: z.string().optional(),
  params: z.record(z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const storeSchema = z.object({
  automations: z.array(storedAutomationSchema).default([]),
});

async function ensureStore(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify({ automations: [] }, null, 2));
  }
}

async function readStore(filePath) {
  await ensureStore(filePath);
  const raw = await fs.readFile(filePath, "utf8");
  return storeSchema.parse(JSON.parse(raw));
}

async function writeStore(filePath, store) {
  await ensureStore(filePath);
  await fs.writeFile(filePath, JSON.stringify(store, null, 2));
}

function createAutomationId() {
  return crypto.randomUUID().slice(0, 8);
}

export async function saveSharedAutomation(filePath, automation) {
  const store = await readStore(filePath);
  const now = new Date().toISOString();
  const id = automation.id || createAutomationId();
  const record = storedAutomationSchema.parse({
    ...automation,
    id,
    name: automation.name?.trim() || "Untitled automation",
    createdAt: automation.createdAt || now,
    updatedAt: now,
  });

  const nextAutomations = store.automations.filter((item) => item.id !== id);
  nextAutomations.push(record);
  await writeStore(filePath, { automations: nextAutomations });
  return record;
}

export async function getSharedAutomation(filePath, id) {
  const store = await readStore(filePath);
  return store.automations.find((item) => item.id === id) || null;
}
