"use client";

import dynamic from "next/dynamic";
import type { GlobeSceneProps } from "./GlobeSceneImpl";

export type { SatelliteMeta, SatelliteSnapshot } from "./GlobeSceneImpl";

const GlobeSceneClient = dynamic(
  () => import("./GlobeSceneImpl").then((module) => module.GlobeScene),
  {
    ssr: false,
    loading: () => <div className="globe-scene scene-loading" aria-label="正在加载三维地球" />,
  },
);

export function GlobeScene(props: GlobeSceneProps) {
  return <GlobeSceneClient {...props} />;
}
