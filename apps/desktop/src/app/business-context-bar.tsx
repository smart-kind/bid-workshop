import { useEffect, useState } from "react";
import type { BusinessWorkspaceContext } from "../../contracts/business-workspace";
import type { PiDesktopApi } from "../../contracts/ipc";

export type BusinessContextState =
  | { readonly status: "loading" }
  | { readonly status: "ok"; readonly context: BusinessWorkspaceContext }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "unavailable" };

function useBusinessContext(
  api: PiDesktopApi | undefined,
  workspaceId: string | undefined,
): BusinessContextState {
  const [state, setState] = useState<BusinessContextState>({ status: "loading" });

  useEffect(() => {
    if (!api || !workspaceId) return;
    let disposed = false;
    setState({ status: "loading" });
    void api.getWorkspaceContext({ workspaceId }).then(
      (result) => {
        if (disposed) return;
        setState(
          result.status === "ok"
            ? { status: "ok", context: result.context }
            : result.status === "invalid"
              ? { status: "invalid", reason: result.reason }
              : result.status === "missing"
                ? { status: "missing" }
                : { status: "unavailable" },
        );
      },
      () => {
        if (!disposed) setState({ status: "unavailable" });
      },
    );
    return () => {
      disposed = true;
    };
  }, [api, workspaceId]);

  return state;
}

interface BusinessContextBarProps {
  readonly api: PiDesktopApi | undefined;
  readonly workspaceId: string | undefined;
}

/**
 * The business layer of the current workspace, always visible above the main
 * pane. It only reads; the open flow and the repair entry point live elsewhere.
 */
export function BusinessContextBar({ api, workspaceId }: BusinessContextBarProps) {
  const state = useBusinessContext(api, workspaceId);
  if (!workspaceId) return null;

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
      {state.status === "missing" ? (
        <span className="business-context__detail">No business profile</span>
      ) : null}
      {state.status === "invalid" ? (
        <span className="business-context__detail" title={state.reason}>
          Business profile invalid
        </span>
      ) : null}
    </div>
  );
}
