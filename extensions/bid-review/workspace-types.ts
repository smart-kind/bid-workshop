/**
 * The zone vocabulary the extension needs, mirroring the app's profile contract.
 * Duplicated on purpose: the extension is a separate package and cannot import
 * the desktop's contracts.
 */
export const WORKSPACE_ZONE_KINDS = ["reference", "material", "output", "feedback"] as const;
export type WorkspaceZoneKind = (typeof WORKSPACE_ZONE_KINDS)[number];
export type WorkspaceZones = { readonly [Kind in WorkspaceZoneKind]: readonly string[] };
