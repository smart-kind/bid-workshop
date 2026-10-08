import type { WorkspaceZones } from "../../workspace-types";

export const EMPTY_ZONES: WorkspaceZones = {
  reference: [],
  material: [],
  output: [],
  feedback: [],
};

/** The design's recommended layout (docs/business-workspace-design.md §5.1). */
export const ZONES: WorkspaceZones = {
  reference: ["公司资料"],
  material: ["招标文件"],
  output: ["产出"],
  feedback: ["意见"],
};
