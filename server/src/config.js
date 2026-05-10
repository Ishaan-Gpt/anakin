import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  ANAKIN_API_KEY: z.string().min(1, "ANAKIN_API_KEY is required"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  ANAKIN_BROWSER_COUNTRY: z.string().default("US"),
  PORT: z.coerce.number().default(8787),
  AUTOMATION_STORE_FILE: z.string().default(path.resolve(process.cwd(), "server", "data", "automations.json")),
});

export const env = envSchema.parse(process.env);
