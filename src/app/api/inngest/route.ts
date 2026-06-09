/**
 * Issue 10 — Inngest serve endpoint. Inngest calls this route to run the queued
 * functions. Locally, point the Inngest dev server here (`npx inngest-cli dev`);
 * in production configure the app's signing key.
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
