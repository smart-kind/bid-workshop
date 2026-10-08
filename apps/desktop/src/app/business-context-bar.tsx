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
  const [goalDraft, setGoalDraft] = useState<string | null>(null);

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
  /** The profile the context came from, rebuilt so it can be written back whole. */
  const profileWithGoal = (goal: string) =>
    state.status === "ok"
      ? {
          schemaVersion: 1,
          business: state.context.business,
          ...(state.context.name === undefined ? {} : { name: state.context.name }),
          ...(goal.trim() ? { goal: goal.trim() } : {}),
          zones: state.context.zones,
          skills: state.context.skills,
          capabilities: { mcp: state.context.mcp },
          delivery: state.context.delivery,
        }
      : null;
  const saveGoal = () => {
    const profile = goalDraft === null ? null : profileWithGoal(goalDraft);
    if (!api || !workspaceId || !profile || pending) return;
    setPending(true);
    api
      .updateWorkspaceProfile({ workspaceId, profile })
      .then((result) => {
        setState(toState(result));
        setGoalDraft(null);
      })
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
      {state.status === "ok" ? (
        goalDraft === null ? (
          <>
            <span className="business-context__goal" data-testid="business-context-goal">
              {state.context.goal ?? "未声明目标"}
            </span>
            <button
              type="button"
              className="business-context__action"
              data-testid="business-context-goal-edit"
              onClick={() => setGoalDraft(state.context.goal ?? "")}
            >
              声明目标
            </button>
          </>
        ) : (
          <>
            <input
              aria-label="审查目标"
              className="business-context__goal-input"
              data-testid="business-context-goal-input"
              onChange={(event) => setGoalDraft(event.target.value)}
              placeholder="例如：按评审条件审查产出目录的投标文件，逐条出批注"
              value={goalDraft}
            />
            <button
              type="button"
              className="business-context__action"
              data-testid="business-context-goal-save"
              disabled={pending}
              onClick={saveGoal}
            >
              保存
            </button>
            <button
              type="button"
              className="business-context__action"
              data-testid="business-context-goal-cancel"
              disabled={pending}
              onClick={() => setGoalDraft(null)}
            >
              取消
            </button>
          </>
        )
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
