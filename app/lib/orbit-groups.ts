import definitions from "../config/orbit-groups.json";

export type SatelliteGlyph = "circle" | "diamond" | "station";

export type OrbitGroupDefinition = {
  id: string;
  celestrakGroup: string;
  label: string;
  color: string;
  marker: {
    shape: SatelliteGlyph;
    size: number;
    opacity: number;
  };
  minimumRecords: number;
  maximumEpochAgeHours: number;
};

export const ORBIT_GROUPS = definitions as OrbitGroupDefinition[];
export const ORBIT_GROUP_IDS = ORBIT_GROUPS.map((group) => group.id);
export const ORBIT_GROUP_BY_ID = new Map(
  ORBIT_GROUPS.map((group) => [group.id, group]),
);
