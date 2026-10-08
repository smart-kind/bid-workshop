import type { StartupDiagnostic } from "../../contracts/desktop-state";

/** Saved workspaces that could not be refreshed on launch. */
export function StartupDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly StartupDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="startup-diagnostics" role="status" data-testid="startup-diagnostics">
      <strong>Some saved workspaces could not be refreshed.</strong>
      <span>
        {diagnostics
          .map((diagnostic) => {
            const workspaceName = diagnostic.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1);
            return workspaceName ? `${workspaceName} is unavailable.` : diagnostic.message;
          })
          .join(" ")}
      </span>
    </div>
  );
}
