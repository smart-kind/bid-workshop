import { useEffect, useMemo, useState } from "react";
import type { WorkspaceZones } from "../../../contracts/business-workspace";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { createZoneResolver, type WorkspaceZoneResolver } from "../../../contracts/workspace-zones";

/**
 * The zone resolver for a workspace, built from the context main projects.
 * The resolver itself is the shared one the write gate uses, so the renderer
 * cannot drift from what main actually refuses.
 */
export function useWorkspaceZones(
  api: PiDesktopApi | undefined,
  workspaceId: string | undefined,
): WorkspaceZoneResolver | undefined {
  const [zones, setZones] = useState<WorkspaceZones | undefined>(undefined);

  useEffect(() => {
    if (!api || !workspaceId) return;
    let disposed = false;
    setZones(undefined);
    void api.getWorkspaceContext({ workspaceId }).then(
      (result) => {
        if (!disposed) setZones(result.status === "ok" ? result.context.zones : undefined);
      },
      () => {
        if (!disposed) setZones(undefined);
      },
    );
    return () => {
      disposed = true;
    };
  }, [api, workspaceId]);

  return useMemo(() => {
    if (!zones) return undefined;
    try {
      return createZoneResolver(zones);
    } catch {
      return undefined;
    }
  }, [zones]);
}
