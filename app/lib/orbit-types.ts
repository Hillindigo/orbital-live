export type SatelliteMeta = {
  index: number;
  name: string;
  norad: string;
  group: string;
  period: number;
  country: string;
  operator: string;
  launchYear: number | null;
  epochTime: number | null;
};

export type SatelliteSnapshot = SatelliteMeta & {
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
};

export type OrbitGroupStatus = {
  group: string;
  source: "loading" | "live" | "snapshot" | "failed";
  recordCount?: number;
  tleEpoch?: number;
  servedAt?: number;
  error?: string;
};

export type GlobeSceneApi = {
  focus: (index: number) => boolean;
  clear: () => void;
  resetTime: () => void;
  setTime: (time: number) => void;
  setAutoRotate: (enabled: boolean) => void;
  setCoverageVisible: (visible: boolean) => void;
  reload: () => void;
};
