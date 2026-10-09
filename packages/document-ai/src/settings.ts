import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultAiSettings, type AiProviderId, type AiSettings } from "@genoffice/ai-provider";

/**
 * The AI panel's provider contract, mirrored here rather than re-exported from
 * `@genoffice/ai-provider`: the project that consumes this package typechecks
 * the vendored sources' own style of imports, which NodeNext rejects, so no name
 * from the vendored package may appear in this package's declarations
 * (see docs/shell-plan.md F3).
 *
 * Only the shell reads these fields — the editor holds the settings object and
 * hands it straight back on every turn — so the mirror is the whole contract.
 */
export interface DocumentAiProviderConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
}

export interface DocumentAiSettings {
  readonly provider: string;
  readonly providers: Record<string, DocumentAiProviderConfig>;
  readonly maxOutputTokens?: number | undefined;
}

/** Keeps the mirror above honest: the build fails if ai-provider renames or drops a field. */
type MirrorCoversAiSettings = AiSettings extends DocumentAiSettings ? true : never;
const mirrorCoversAiSettings: MirrorCoversAiSettings = true;
void mirrorCoversAiSettings;

/** ai-provider ids the registry routes over the OpenAI chat-completions protocol. */
const OPENAI_COMPATIBLE_IDS = new Set([
  "deepseek",
  "openai",
  "kimi",
  "glm",
  "qwen",
  "doubao",
  "minimax",
  "xai",
  "mistral",
  "openrouter",
  "requesty",
  "opper",
  "custom",
]);

/** pi's per-provider record in `models.json`. */
interface PiProviderEntry {
  readonly baseUrl?: unknown;
  readonly api?: unknown;
  readonly apiKey?: unknown;
  readonly models?: unknown;
}

/**
 * The document editor's AI panel is served from **pi's own model configuration**
 * rather than from a provider store of its own. The shell already has exactly
 * one place where providers are configured — `getAgentDir()/models.json` plus
 * the default provider/model in `settings.json` — and a second, unconfigured
 * store would only be a way for the panel to be dead on arrival.
 *
 * `settings.provider` picks the wire protocol through ai-provider's registry, so
 * the mapping is **protocol-first**: pi records each provider's wire shape in its
 * `api` field, and the id handed back has to resolve to that same protocol or the
 * request goes out in the wrong dialect. An `anthropic-messages` pi provider
 * therefore becomes ai-provider's `anthropic` (whose adapter honours a stored
 * base URL), never `qwen` — pi's qwen here points at DashScope's *Anthropic*
 * endpoint, not its OpenAI-compatible one.
 *
 * `agentDir` comes from the caller; resolving it is the shell's business.
 */
export async function readDocumentAiSettings(agentDir: string): Promise<DocumentAiSettings> {
  const settings = defaultAiSettings();
  const [rawSettings, rawModels] = await Promise.all([
    readJsonFile(join(agentDir, "settings.json")),
    readJsonFile(join(agentDir, "models.json")),
  ]);
  const selected = selectProvider(rawSettings, rawModels);
  if (!selected) return settings;
  settings.provider = selected.providerId;
  settings.providers[selected.providerId] = selected.config;
  return settings;
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function selectProvider(
  rawSettings: unknown,
  rawModels: unknown,
): { providerId: AiProviderId; config: DocumentAiProviderConfig } | null {
  const providers = field(rawModels, "providers");
  if (!providers || typeof providers !== "object") return null;
  const entries = providers as Record<string, PiProviderEntry>;
  const preferred = field(rawSettings, "defaultProvider");
  const key =
    typeof preferred === "string" && entries[preferred] ? preferred : Object.keys(entries)[0];
  if (!key) return null;
  const entry = entries[key];
  if (!entry) return null;
  const apiKey = text(entry.apiKey);
  const baseUrl = text(entry.baseUrl);
  const model = pickModel(entry.models, field(rawSettings, "defaultModel"));
  // A half-configured provider is worse than none: the defaults at least let the
  // turn fail with ai-provider's own "no API key" rather than a malformed request.
  if (!apiKey || !baseUrl || !model) return null;
  return { providerId: providerIdFor(key, text(entry.api)), config: { apiKey, model, baseUrl } };
}

function providerIdFor(key: string, api: string): AiProviderId {
  const wire = api.toLowerCase();
  if (wire.includes("anthropic")) return "anthropic";
  if (wire.includes("gemini") || wire.includes("google")) return "gemini";
  const id = key.toLowerCase();
  return OPENAI_COMPATIBLE_IDS.has(id) ? (id as AiProviderId) : "custom";
}

/** The model pi names as default when this provider serves it, else its first one. */
function pickModel(raw: unknown, preferred: unknown): string {
  const ids = Array.isArray(raw)
    ? raw.flatMap((entry) => {
        const id = field(entry, "id");
        return typeof id === "string" && id !== "" ? [id] : [];
      })
    : [];
  const want = text(preferred);
  if (want && (ids.length === 0 || ids.includes(want))) return want;
  return ids[0] ?? "";
}

function field(source: unknown, name: string): unknown {
  return source && typeof source === "object"
    ? (source as Record<string, unknown>)[name]
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
