import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * The extension's own lane: document-engine work with no Electron shell in it,
 * but which only resolves from this package's dependencies.
 */
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: fileURLToPath(new URL("./tests", import.meta.url)),
  timeout: 60_000,
  workers: 1,
  use: { trace: "retain-on-failure" },
});
