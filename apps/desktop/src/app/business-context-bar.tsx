import { useEffect, useMemo, useState } from "react";
import type { BusinessWorkspaceContext } from "../../contracts/business-workspace";
import type {
  BusinessWorkspaceContextResult,
  BusinessWorkspaceSuggestion,
  PiDesktopApi,
} from "../../contracts/ipc";
import { createZoneResolver } from "../../contracts/workspace-zones";

export type BusinessContextState =
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly context: BusinessWorkspaceContext }
  | { readonly status: "missing"; readonly suggestion: BusinessWorkspaceSuggestion }
  | {
      readonly status: "invalid";
      readonly reason: string;
      readonly suggestion: BusinessWorkspaceSuggestion;
    }
  | { readonly status: "unavailable" };

function toState(result: BusinessWorkspaceContextResult): BusinessContextState {
  switch (result.status) {
    case "ok":
      return { status: "ok", context: result.context };
    case "missing":
      return { status: "missing", suggestion: result.suggestion };
    case "invalid":
      return { status: "invalid", reason: result.reason, suggestion: result.suggestion };
    default:
      return { status: "unavailable" };
  }
}

function describeSuggestion(suggestion: BusinessWorkspaceSuggestion): string {
  const parts: string[] = [];
  if (suggestion.criteriaFile) parts.push(`found ${suggestion.criteriaFile}`);
  if (suggestion.documents.length > 0) {
    parts.push(
      `${suggestion.documents.length} document${suggestion.documents.length > 1 ? "s" : ""}`,
    );
  }
  if (suggestion.zoneDirectories.length > 0) {
    parts.push(`${suggestion.zoneDirectories.length} standard folders`);
  }
  return parts.join(", ");
}

interface BusinessContextBarProps {
  readonly api: PiDesktopApi | undefined;
  readonly workspaceId: string | undefined;
  /** Locate a declared zone directory in the Files pane. */
  readonly onLocateZone?: (path: string) => void;
}

/**
 * The business layer of the current workspace, always visible above the main
 * pane. It reads the profile, offers the recommended one when the folder looks
 * like a bid workspace, and repairs an unusable profile — while never blocking
 * the folder from opening.
 */
export function BusinessContextBar({ api, workspaceId, onLocateZone }: BusinessContextBarProps) {
  const [state, setState] = useState<BusinessContextState>({ status: "loading" });
  const [declined, setDeclined] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!api || !workspaceId) return;
    let disposed = false;
    setState({ status: "loading" });
    setDeclined(false);
    void api.getWorkspaceContext({ workspaceId }).then(
      (result) => {
        if (!disposed) setState(toState(result));
      },
      () => {
        if (!disposed) setState({ status: "unavailable" });
      },
    );
    return () => {
      disposed = true;
    };
  }, [api, workspaceId]);

  const zoneEntries = useMemo(() => {
    if (state.status !== "ok" || !state.context.zoned) return [];
    try {
      return createZoneResolver(state.context.zones).entries;
    } catch {
      return [];
    }
  }, [state]);

  if (!workspaceId) return null;

  const suggestion =
    state.status === "missing" || state.status === "invalid" ? state.suggestion : undefined;
  const applyProfile = () => {
    if (!api || !suggestion || pending) return;
    setPending(true);
    api
      .updateWorkspaceProfile({ workspaceId, profile: suggestion.proposedProfile })
      .then((result) => setState(toState(result)))
      .catch(() => setState({ status: "unavailable" }))
      .finally(() => setPending(false));
  };
  const askToInitialise = state.status === "missing" && suggestion?.looksLikeBusiness && !declined;

  return (
    <div
      className="business-context"
      data-testid="business-context-bar"
      data-status={state.status}
      role="status"
    >
      {state.status === "ok" ? (
        <>
          <span className="business-context__label" data-testid="business-context-business">
            {state.context.business}
          </span>
          <span className="business-context__detail">
            {state.context.zoned ? "Zoned workspace" : "No zones declared"}
          </span>
          {zoneEntries.map((entry) => (
            <button
              key={`${entry.kind}:${entry.path}`}
              type="button"
              className={`business-context__zone${entry.readOnly ? " business-context__zone--read-only" : ""}`}
              data-testid="business-context-zone"
              data-zone-kind={entry.kind}
              data-zone-path={entry.path}
              data-zone-read-only={entry.readOnly ? "true" : "false"}
              onClick={() => onLocateZone?.(entry.path)}
            >
              {entry.path}
            </button>
          ))}
        </>
      ) : null}
      {askToInitialise && suggestion ? (
        <>
          <span className="business-context__label">This looks like a bid workspace</span>
          <span className="business-context__detail">{describeSuggestion(suggestion)}</span>
          <button
            type="button"
            className="business-context__action"
            data-testid="business-context-initialise"
            disabled={pending}
            onClick={applyProfile}
          >
            Set it up
          </button>
          <button
            type="button"
            className="business-context__action"
            data-testid="business-context-dismiss"
            disabled={pending}
            onClick={() => setDeclined(true)}
          >
            Not now
          </button>
        </>
      ) : null}
      {state.status === "missing" && !askToInitialise ? (
        <span className="business-context__detail" data-testid="business-context-note">
          No business profile
        </span>
      ) : null}
      {state.status === "invalid" ? (
        <>
          <span className="business-context__label">Business profile invalid</span>
          <span className="business-context__detail" data-testid="business-context-reason">
            {state.reason}
          </span>
          <button
            type="button"
            className="business-context__action"
            data-testid="business-context-rebuild"
            disabled={pending}
            onClick={applyProfile}
          >
            Rebuild
          </button>
        </>
      ) : null}
    </div>
  );
}
