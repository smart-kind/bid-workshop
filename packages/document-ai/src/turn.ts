import type { AgentMessage, AgentToolDef } from "@genoffice/agent-core";
import {
  AiCreditsError,
  AiTimeoutError,
  getProviderAdapter,
  isAiNetworkError,
  isAiOverloadedError,
  maxOutputTokensOf,
  streamForProvider,
  type AiProviderId,
  type AiSettings,
  type AiStreamChunk,
} from "@genoffice/ai-provider";
import type { DocumentAiSettings } from "./settings.js";

/**
 * One chunk of a streamed panel turn — ai-provider's own `AiStreamChunk`, which
 * the editor's half of the bridge already consumes. It is mirrored rather than
 * re-exported for the same reason as the settings in ./settings.
 */
export interface DocumentAiChunk {
  readonly requestId: string;
  /** 'ping' is a wire-level keepalive that carries no payload */
  readonly type: "delta" | "reasoning" | "tool-call" | "done" | "error" | "ping";
  readonly text?: string;
  readonly toolCall?: unknown;
  readonly error?: string;
  readonly errorCode?: "timeout" | "credits" | "network" | "overloaded";
  readonly stopReason?: string;
}

/** Keeps the mirror above honest: the build fails if ai-provider's chunk shape moves. */
type MirrorCoversAiChunks = AiStreamChunk extends DocumentAiChunk ? true : never;
const mirrorCoversAiChunks: MirrorCoversAiChunks = true;
void mirrorCoversAiChunks;

/** One turn of the panel, as the document preload forwards it. */
export interface DocumentAiTurnRequest {
  readonly requestId: string;
  readonly settings: DocumentAiSettings;
  readonly system: string;
  readonly messages: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly maxTokens?: number | undefined;
  readonly sessionId?: string | undefined;
}

/** How often a live turn re-arms the renderer's silence watchdog at most. */
const PING_INTERVAL_MS = 5_000;

/**
 * Runs one model turn for the document editor's AI panel, reporting every chunk
 * through `emit`. Failures arrive as `error` chunks rather than rejections: the
 * panel renders them the same way it renders a provider's own error.
 *
 * The turn is routed by `settings.provider` through ai-provider's registry, so
 * whatever `readDocumentAiSettings` put there decides the wire protocol. A
 * provider the registry does not know, or one with no key or model, is refused
 * before any request goes out.
 */
export async function streamDocumentAiTurn(
  request: DocumentAiTurnRequest,
  signal: AbortSignal,
  emit: (chunk: DocumentAiChunk) => void,
): Promise<void> {
  const { requestId } = request;
  const settings = request.settings as AiSettings | undefined;
  const provider = typeof settings?.provider === "string" ? settings.provider : "";
  const config = provider === "" ? undefined : settings?.providers?.[provider as AiProviderId];
  if (!provider || !config) {
    emit({ requestId, type: "error", error: "No AI provider is configured for this document." });
    return;
  }
  try {
    getProviderAdapter(provider as AiProviderId);
  } catch {
    emit({ requestId, type: "error", error: `Unknown AI provider: ${provider}.` });
    return;
  }
  if (!config.apiKey) {
    // Nothing configured lands on the shell's defaults, whose provider is the
    // sign-in one — naming it would only puzzle a user who never chose it.
    emit({
      requestId,
      type: "error",
      error:
        provider === "genspark"
          ? "No AI provider is configured for this app yet."
          : `No API key is configured for ${provider}.`,
    });
    return;
  }
  if (!config.model) {
    emit({ requestId, type: "error", error: `No model is configured for ${provider}.` });
    return;
  }

  // Wire activity re-arms the renderer's watchdog, so a slow turn is not read as a dead one.
  let lastPing = 0;
  const ping = (): void => {
    const now = Date.now();
    if (now - lastPing < PING_INTERVAL_MS) return;
    lastPing = now;
    emit({ requestId, type: "ping" });
  };

  try {
    let stopReason: string | undefined;
    await streamForProvider(
      provider as AiProviderId,
      config,
      request.system,
      request.messages as AgentMessage[],
      request.tools as AgentToolDef[],
      request.maxTokens ?? maxOutputTokensOf(settings),
      {
        signal,
        onDelta: (text) => emit({ requestId, type: "delta", text }),
        onReasoningDelta: (text) => emit({ requestId, type: "reasoning", text }),
        onToolCall: (toolCall) => emit({ requestId, type: "tool-call", toolCall }),
        onActivity: ping,
        onStopReason: (reason) => {
          stopReason = reason;
        },
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      },
    );
    emit({ requestId, type: "done", stopReason });
  } catch (error) {
    // An abort is the user stopping the turn, not a failure to report.
    if (signal.aborted) emit({ requestId, type: "done" });
    else emit({ requestId, type: "error", error: messageOf(error), ...errorCodeOf(error) });
  }
}

function errorCodeOf(error: unknown): { errorCode?: DocumentAiChunk["errorCode"] } {
  if (error instanceof AiTimeoutError) return { errorCode: "timeout" };
  if (error instanceof AiCreditsError) return { errorCode: "credits" };
  if (isAiNetworkError(error)) return { errorCode: "network" };
  if (isAiOverloadedError(error)) return { errorCode: "overloaded" };
  return {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
