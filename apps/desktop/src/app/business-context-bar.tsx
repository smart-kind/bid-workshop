import { useEffect, useState } from "react";
import type { BusinessWorkspaceContext } from "../../contracts/business-workspace";
import type {
  BusinessWorkspaceContextResult,
  BusinessWorkspaceSuggestion,
  PiDesktopApi,
} from "../../contracts/ipc";

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
}

/**
 * The business layer of the current workspace, always visible above the main
 * pane. It reads the profile, offers the recommended one when the folder looks
 * like a bid workspace, and repairs an unusable profile — while never blocking
 * the folder from opening.
 */
export function BusinessContextBar({ api, workspaceId }: BusinessContextBarProps) {
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
