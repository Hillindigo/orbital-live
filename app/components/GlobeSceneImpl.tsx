"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { feature, mesh } from "topojson-client";
import countriesAtlas from "world-atlas/countries-110m.json";
import {
  ORBIT_GROUP_IDS,
  ORBIT_GROUPS,
  type SatelliteGlyph,
} from "../lib/orbit-groups";
import {
  OVERVIEW_MAX_DISTANCE,
  getFocusCameraDistance,
} from "../lib/orbit-camera.mjs";
import type {
  GlobeSceneApi,
  OrbitGroupStatus,
  SatelliteMeta,
  SatelliteSnapshot,
} from "../lib/orbit-types";
import { parseTleMetadata } from "../lib/tle-data.mjs";

export type GlobeSceneProps = {
  activeGroups: Set<string>;
  speed: number;
  playing: boolean;
  onReady: (satellites: SatelliteMeta[]) => void;
  onSelect: (satellite: SatelliteSnapshot | null) => void;
  onStatus: (status: string) => void;
  onDataStatus: (statuses: OrbitGroupStatus[]) => void;
  onTime: (time: number) => void;
  onApi: (api: GlobeSceneApi) => void;
};

type LoadedGroup = {
  group: string;
  text: string;
  source: "live" | "snapshot";
  recordCount: number;
  tleEpoch?: number;
  servedAt: number;
};

const GROUP_COLORS = new Map(
  ORBIT_GROUPS.map((group) => [group.id, new THREE.Color(group.color)]),
);
const GROUP_MARKERS = new Map(
  ORBIT_GROUPS.map((group) => [group.id, group.marker]),
);

function lonLatToVector(lon: number, lat: number, radius = 1) {
  const longitude = THREE.MathUtils.degToRad(lon);
  const latitude = THREE.MathUtils.degToRad(lat);
  const cosLat = Math.cos(latitude);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(longitude),
    radius * Math.sin(latitude),
    -radius * cosLat * Math.sin(longitude),
  );
}

function makePointTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.2, "rgba(255,255,255,.95)");
  gradient.addColorStop(0.48, "rgba(255,255,255,.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSatelliteGlyphTexture(shape: SatelliteGlyph) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  const center = 48;
  const glow = context.createRadialGradient(center, center, 3, center, center, 44);
  glow.addColorStop(0, "rgba(255,255,255,.42)");
  glow.addColorStop(0.42, "rgba(255,255,255,.14)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 96, 96);

  context.fillStyle = "rgba(255,255,255,1)";
  if (shape === "circle") {
    context.beginPath();
    context.arc(center, center, 16, 0, Math.PI * 2);
    context.fill();
  } else if (shape === "diamond") {
    context.beginPath();
    context.moveTo(center, 24);
    context.lineTo(72, center);
    context.lineTo(center, 72);
    context.lineTo(24, center);
    context.closePath();
    context.fill();
  } else {
    context.lineWidth = 8;
    context.strokeStyle = "rgba(255,255,255,1)";
    context.strokeRect(30, 30, 36, 36);
    context.fillStyle = "rgba(255,255,255,.72)";
    context.fillRect(43, 43, 10, 10);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createEarthTextures() {
  const width = 2048;
  const height = 1024;
  const landCanvas = document.createElement("canvas");
  landCanvas.width = width;
  landCanvas.height = height;
  const context = landCanvas.getContext("2d")!;
  const countries = feature(
    countriesAtlas as never,
    (countriesAtlas as unknown as { objects: { countries: never } }).objects.countries,
  ) as unknown as { features: Array<{ geometry: { type: string; coordinates: unknown } }> };
  const drawRing = (ring: number[][]) => {
    ring.forEach(([longitude, latitude], index) => {
      const x = ((longitude + 180) / 360) * width;
      const y = ((90 - latitude) / 180) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  };
  context.fillStyle = "#ffffff";
  countries.features.forEach(({ geometry }) => {
    context.beginPath();
    if (geometry.type === "Polygon") {
      (geometry.coordinates as number[][][]).forEach(drawRing);
    } else if (geometry.type === "MultiPolygon") {
      (geometry.coordinates as number[][][][]).forEach((polygon) => polygon.forEach(drawRing));
    }
    context.fill("evenodd");
  });

  const landMap = new THREE.CanvasTexture(landCanvas);
  const lightsMap = new THREE.TextureLoader().load("/earth-night-lights-2016.jpg");
  landMap.colorSpace = THREE.NoColorSpace;
  lightsMap.colorSpace = THREE.SRGBColorSpace;
  return { landMap, lightsMap };
}

function sunDirection(date: Date) {
  const julianDate = date.getTime() / 86400000 + 2440587.5;
  const days = julianDate - 2451545;
  const meanLongitude = THREE.MathUtils.degToRad((280.46 + 0.9856474 * days) % 360);
  const anomaly = THREE.MathUtils.degToRad((357.528 + 0.9856003 * days) % 360);
  const eclipticLongitude = meanLongitude
    + THREE.MathUtils.degToRad(1.915) * Math.sin(anomaly)
    + THREE.MathUtils.degToRad(0.02) * Math.sin(2 * anomaly);
  const obliquity = THREE.MathUtils.degToRad(23.439 - 0.0000004 * days);
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const sidereal = THREE.MathUtils.degToRad((280.46061837 + 360.98564736629 * days) % 360);
  const longitude = THREE.MathUtils.radToDeg(rightAscension - sidereal);
  return lonLatToVector(longitude, THREE.MathUtils.radToDeg(declination)).normalize();
}

function createEarth() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 96, 64);
  const { landMap, lightsMap } = createEarthTextures();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      lightDirection: { value: sunDirection(new Date()) },
      landMap: { value: landMap },
      lightsMap: { value: lightsMap },
    },
    vertexShader: `
      varying vec3 vNormalWorld;
      varying vec3 vPositionWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vPositionWorld = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 lightDirection;
      uniform sampler2D landMap;
      uniform sampler2D lightsMap;
      varying vec3 vNormalWorld;
      varying vec3 vPositionWorld;
      varying vec2 vUv;
      void main() {
        float solar = dot(normalize(vNormalWorld), lightDirection);
        float daylight = smoothstep(-0.12, 0.18, solar);
        float land = texture2D(landMap, vUv).r;
        vec3 observedNight = texture2D(lightsMap, vUv).rgb;
        float observedLuminance = dot(observedNight, vec3(0.2126, 0.7152, 0.0722));
        vec3 cityLights = observedNight * smoothstep(0.035, 0.32, observedLuminance);
        float polar = pow(abs(vNormalWorld.y), 3.0);
        vec3 oceanNight = vec3(0.003, 0.012, 0.025);
        vec3 oceanDay = vec3(0.012, 0.105, 0.19);
        vec3 landNight = vec3(0.008, 0.021, 0.024);
        vec3 landDay = vec3(0.075, 0.23, 0.19);
        vec3 night = mix(oceanNight, landNight, land);
        vec3 day = mix(oceanDay, landDay, land);
        vec3 ice = vec3(0.48, 0.68, 0.7) * polar * land * daylight * 0.48;
        vec3 color = mix(night, day, daylight) + ice;
        color += cityLights * (1.0 - smoothstep(-0.28, 0.02, solar)) * 2.8;
        color += vec3(0.05, 0.19, 0.2) * exp(-pow(solar / 0.075, 2.0)) * 0.35;
        float rim = pow(1.0 - max(dot(normalize(vNormalWorld), normalize(cameraPosition - vPositionWorld)), 0.0), 3.0);
        color += vec3(0.02, 0.18, 0.23) * rim;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  group.add(new THREE.Mesh(geometry, material));

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.075, 72, 48),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vNormal; void main(){float a=pow(max(0.0,1.0-abs(vNormal.z)),2.7);gl_FragColor=vec4(0.08,0.72,0.92,a*.22);}`,
    }),
  );
  group.add(atmosphere);
  return { group, material, textures: [landMap, lightsMap] };
}

function createGraticule() {
  const positions: number[] = [];
  const addLine = (points: THREE.Vector3[]) => {
    for (let index = 1; index < points.length; index += 1) {
      positions.push(...points[index - 1].toArray(), ...points[index].toArray());
    }
  };
  for (let lat = -60; lat <= 60; lat += 30) {
    const points: THREE.Vector3[] = [];
    for (let lon = -180; lon <= 180; lon += 3) points.push(lonLatToVector(lon, lat, 1.002));
    addLine(points);
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const points: THREE.Vector3[] = [];
    for (let lat = -90; lat <= 90; lat += 3) points.push(lonLatToVector(lon, lat, 1.002));
    addLine(points);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x2b7383, transparent: true, opacity: 0.18, depthWrite: false }),
  );
}

function createStars() {
  const positions = new Float32Array(3000 * 3);
  for (let index = 0; index < 3000; index += 1) {
    const u = ((index * 0.61803398875) % 1) * 2 - 1;
    const theta = ((index * 1.3247179572) % 1) * Math.PI * 2;
    const radius = 6 + ((index * 0.4142135623) % 1) * 8;
    const spread = Math.sqrt(1 - u * u);
    positions[index * 3] = radius * spread * Math.cos(theta);
    positions[index * 3 + 1] = radius * u;
    positions[index * 3 + 2] = radius * spread * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xb8dae3, size: 0.012, transparent: true, opacity: 0.48, depthWrite: false }),
  );
}

async function addCoastlines(scene: THREE.Scene, signal: AbortSignal) {
  try {
    const response = await fetch("/ne_110m_land.json", { signal });
    const geojson = await response.json();
    const positions: number[] = [];
    const addRing = (ring: number[][]) => {
      for (let index = 1; index < ring.length; index += 1) {
        const previous = lonLatToVector(ring[index - 1][0], ring[index - 1][1], 1.004);
        const current = lonLatToVector(ring[index][0], ring[index][1], 1.004);
        positions.push(...previous.toArray(), ...current.toArray());
      }
    };
    geojson.features.forEach((feature: { geometry: { type: string; coordinates: unknown } }) => {
      const coordinates = feature.geometry.coordinates as number[][][][];
      if (feature.geometry.type === "Polygon") {
        (coordinates as unknown as number[][][]).forEach(addRing);
      } else if (feature.geometry.type === "MultiPolygon") {
        coordinates.forEach((polygon) => polygon.forEach(addRing));
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (signal.aborted) return;
    scene.add(new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x63b5ba, transparent: true, opacity: 0.5, depthWrite: false }),
    ));
  } catch {
    // The globe remains usable with the graticule if the boundary file is unavailable.
  }
}

function createCountryBoundaries() {
  const topology = countriesAtlas as unknown as { objects: { countries: never } };
  const boundaries = mesh(countriesAtlas as never, topology.objects.countries, (a, b) => a !== b) as unknown as {
    coordinates: number[][][];
  };
  const positions: number[] = [];
  boundaries.coordinates.forEach((line) => {
    for (let index = 1; index < line.length; index += 1) {
      positions.push(
        ...lonLatToVector(line[index - 1][0], line[index - 1][1], 1.007).toArray(),
        ...lonLatToVector(line[index][0], line[index][1], 1.007).toArray(),
      );
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x86d5d0, transparent: true, opacity: 0.34, depthWrite: false }),
  );
}

export function GlobeScene({ activeGroups, speed, playing, onReady, onSelect, onStatus, onDataStatus, onTime, onApi }: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeGroupsRef = useRef(activeGroups);
  const speedRef = useRef(speed);
  const playingRef = useRef(playing);
  const recolorRef = useRef<(() => void) | null>(null);

  useEffect(() => { activeGroupsRef.current = activeGroups; recolorRef.current?.(); }, [activeGroups]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02080c);
    scene.fog = new THREE.FogExp2(0x02080c, 0.025);
    const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.01, 50);
    camera.position.set(0.3, 0.25, 3.2);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      onStatus("WebGL 不可用 · 请开启硬件加速");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    scene.add(createStars());
    const earth = createEarth();
    scene.add(earth.group);
    scene.add(createGraticule());
    scene.add(createCountryBoundaries());
    const coastlineAbortController = new AbortController();
    const dataAbortController = new AbortController();
    void addCoastlines(scene, coastlineAbortController.signal);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.65;
    controls.maxDistance = OVERVIEW_MAX_DISTANCE;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    controls.autoRotate = !reducedMotion.matches;
    let autoRotateEnabled = !reducedMotion.matches;

    const selectionTexture = makePointTexture();
    type PointLayer = {
      indices: number[];
      positions: Float32Array | null;
      geometry: THREE.BufferGeometry;
      points: THREE.Points;
    };
    const pointLayers = new Map<string, PointLayer>();
    const pointTextures: THREE.Texture[] = [selectionTexture];

    ORBIT_GROUP_IDS.forEach((group) => {
      const marker = GROUP_MARKERS.get(group)!;
      const texture = makeSatelliteGlyphTexture(marker.shape);
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.PointsMaterial({
        // Sprite sizes are screen-space pixels: zooming in must not make a
        // satellite category disappear or become indistinguishable.
        size: marker.size,
        map: texture,
        color: GROUP_COLORS.get(group)!,
        transparent: true,
        opacity: marker.opacity,
        alphaTest: 0.02,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: false,
      });
      const points = new THREE.Points(geometry, material);
      // Positions are updated by a Worker every frame; avoid stale bounds hiding
      // a category after a close camera move.
      points.frustumCulled = false;
      scene.add(points);
      pointTextures.push(texture);
      pointLayers.set(group, { indices: [], positions: null, geometry, points });
    });

    const orbitGeometry = new THREE.BufferGeometry();
    const orbitLine = new THREE.Line(
      orbitGeometry,
      new THREE.LineBasicMaterial({ color: 0xcff8ff, transparent: true, opacity: 0.64, depthWrite: false }),
    );
    orbitLine.visible = false;
    scene.add(orbitLine);

    const coverageGeometry = new THREE.BufferGeometry();
    const coverageLine = new THREE.LineLoop(
      coverageGeometry,
      new THREE.LineBasicMaterial({ color: 0x68deeb, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    coverageLine.visible = false;
    scene.add(coverageLine);

    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: selectionTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    marker.scale.setScalar(0.12);
    marker.visible = false;
    scene.add(marker);

    const worker = new Worker(new URL("../workers/orbit.worker.ts", import.meta.url), { type: "module" });
    let satellites: SatelliteMeta[] = [];
    let nowPositions: Float32Array | null = null;
    let nextPositions: Float32Array | null = null;
    let renderedPositions: Float32Array | null = null;
    let telemetry: Float32Array | null = null;
    let selectedIndex = -1;
    let pendingFocusIndex = -1;
    let cameraBeforeFocus: THREE.Vector3 | null = null;
    let targetBeforeFocus: THREE.Vector3 | null = null;
    let frameStart = performance.now();
    let frameDuration = 1000;
    let disposed = false;
    let simulationTime = Date.now();
    let lastRealTime = performance.now();
    let focusTarget: THREE.Vector3 | null = null;
    let updateTimer = 0;
    let frameRequestedAt = 0;
    let dataSummary = "正在加载数据";
    let dataRequestId = 0;
    let coverageVisible = true;

    const readVisualPosition = (target: THREE.Vector3, index: number) => {
      return target.fromArray(renderedPositions!, index * 3);
    };

    const applyGroupVisibility = () => {
      pointLayers.forEach((layer, group) => {
        layer.points.visible = activeGroupsRef.current.has(group);
      });
    };

    const buildPointLayers = () => {
      pointLayers.forEach((layer, group) => {
        layer.indices = satellites.flatMap((satellite, index) => satellite.group === group ? [index] : []);
        layer.positions = new Float32Array(layer.indices.length * 3);
        const attribute = new THREE.BufferAttribute(layer.positions, 3);
        attribute.setUsage(THREE.DynamicDrawUsage);
        layer.geometry.setAttribute("position", attribute);
      });
      applyGroupVisibility();
    };

    const syncPointLayerPositions = () => {
      if (!renderedPositions) return;
      pointLayers.forEach((layer) => {
        if (!layer.positions) return;
        layer.indices.forEach((satelliteIndex, pointIndex) => {
          const sourceOffset = satelliteIndex * 3;
          const targetOffset = pointIndex * 3;
          layer.positions![targetOffset] = renderedPositions![sourceOffset];
          layer.positions![targetOffset + 1] = renderedPositions![sourceOffset + 1];
          layer.positions![targetOffset + 2] = renderedPositions![sourceOffset + 2];
        });
        layer.geometry.attributes.position.needsUpdate = true;
      });
    };
    recolorRef.current = applyGroupVisibility;

    const handleReducedMotionChange = () => {
      if (selectedIndex < 0) controls.autoRotate = autoRotateEnabled && !reducedMotion.matches;
    };
    reducedMotion.addEventListener("change", handleReducedMotionChange);

    const updateCoverage = (index: number) => {
      if (!renderedPositions || !telemetry) return;
      const center = new THREE.Vector3(
        renderedPositions[index * 3],
        renderedPositions[index * 3 + 1],
        renderedPositions[index * 3 + 2],
      ).normalize();
      const altitude = Math.max(telemetry[index * 4 + 2], 1);
      const horizonAngle = Math.acos(6378.137 / (6378.137 + altitude));
      const helper = Math.abs(center.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const tangentA = new THREE.Vector3().crossVectors(center, helper).normalize();
      const tangentB = new THREE.Vector3().crossVectors(center, tangentA).normalize();
      const circle = new Float32Array(129 * 3);
      for (let step = 0; step <= 128; step += 1) {
        const angle = (step / 128) * Math.PI * 2;
        const point = center.clone().multiplyScalar(Math.cos(horizonAngle))
          .addScaledVector(tangentA, Math.sin(horizonAngle) * Math.cos(angle))
          .addScaledVector(tangentB, Math.sin(horizonAngle) * Math.sin(angle))
          .multiplyScalar(1.006);
        point.toArray(circle, step * 3);
      }
      coverageGeometry.setAttribute("position", new THREE.BufferAttribute(circle, 3));
      coverageLine.visible = coverageVisible;
    };

    const emitSelection = (index: number) => {
      if (!telemetry || !satellites[index]) return;
      const satellite = satellites[index];
      onSelect({
        ...satellite,
        latitude: telemetry[index * 4],
        longitude: telemetry[index * 4 + 1],
        altitude: telemetry[index * 4 + 2],
        velocity: telemetry[index * 4 + 3],
      });
    };

    const focus = (index: number) => {
      if (!satellites[index]) return false;
      if (selectedIndex >= 0 || pendingFocusIndex >= 0) clear();
      if (!renderedPositions) {
        pendingFocusIndex = index;
        return true;
      }
      cameraBeforeFocus = camera.position.clone();
      targetBeforeFocus = controls.target.clone();
      selectedIndex = index;
      controls.autoRotate = false;
      marker.visible = true;
      orbitLine.visible = false;
      emitSelection(index);
      updateCoverage(index);
      const position = readVisualPosition(new THREE.Vector3(), index);
      focusTarget = position.clone().normalize()
        .multiplyScalar(getFocusCameraDistance(position.length()));
      worker.postMessage({ type: "orbit", index, time: simulationTime });
      return true;
    };
    const clear = () => {
      if (selectedIndex < 0 && pendingFocusIndex < 0) return;
      selectedIndex = -1;
      pendingFocusIndex = -1;
      marker.visible = false;
      orbitLine.visible = false;
      coverageLine.visible = false;
      orbitGeometry.deleteAttribute("position");
      coverageGeometry.deleteAttribute("position");
      if (cameraBeforeFocus && targetBeforeFocus) {
        camera.position.copy(cameraBeforeFocus);
        controls.target.copy(targetBeforeFocus);
      }
      focusTarget = null;
      controls.autoRotate = autoRotateEnabled && !reducedMotion.matches;
      cameraBeforeFocus = null;
      targetBeforeFocus = null;
      onSelect(null);
    };
    const resetTime = () => {
      simulationTime = Date.now();
      lastRealTime = performance.now();
      window.clearTimeout(updateTimer);
      requestFrame();
    };
    const setTime = (time: number) => {
      if (!Number.isFinite(time)) return;
      simulationTime = time;
      lastRealTime = performance.now();
      window.clearTimeout(updateTimer);
      requestFrame();
    };
    const setAutoRotate = (enabled: boolean) => {
      autoRotateEnabled = enabled;
      if (selectedIndex < 0) controls.autoRotate = enabled && !reducedMotion.matches;
    };
    const setCoverageVisible = (visible: boolean) => {
      coverageVisible = visible;
      coverageLine.visible = visible && selectedIndex >= 0;
    };

    const requestFrame = () => {
      if (disposed || !satellites.length) return;
      const realNow = performance.now();
      if (playingRef.current) simulationTime += (realNow - lastRealTime) * speedRef.current;
      lastRealTime = realNow;
      const duration = Math.max(350, 1000 / Math.sqrt(speedRef.current));
      const nextTime = playingRef.current
        ? simulationTime + duration * speedRef.current
        : simulationTime;
      frameRequestedAt = performance.now();
      worker.postMessage({ type: "frame", time: simulationTime, nextTime });
    };

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "ready") {
        satellites = message.satellites;
        onReady(satellites);
        buildPointLayers();
        onStatus(`${dataSummary} · ${satellites.length.toLocaleString("zh-CN")} 颗目标`);
        requestFrame();
      } else if (message.type === "frame") {
        nowPositions = message.now;
        nextPositions = message.next;
        telemetry = message.telemetry;
        earth.material.uniforms.lightDirection.value.copy(sunDirection(new Date(message.time)));
        frameStart = performance.now();
        frameDuration = Math.max(250, message.nextTime - message.time) / Math.max(speedRef.current, 1);
        if (!renderedPositions || renderedPositions.length !== nowPositions!.length) {
          renderedPositions = nowPositions!.slice();
          syncPointLayerPositions();
        }
        if (pendingFocusIndex >= 0) {
          const index = pendingFocusIndex;
          pendingFocusIndex = -1;
          focus(index);
        }
        if (selectedIndex >= 0) emitSelection(selectedIndex);
        onTime(message.time);
        const interval = Math.max(350, 1000 / Math.sqrt(speedRef.current));
        const delay = Math.max(0, interval - (performance.now() - frameRequestedAt));
        updateTimer = window.setTimeout(requestFrame, delay);
      } else if (message.type === "orbit" && message.index === selectedIndex) {
        const orbitPoints = message.points.slice();
        orbitGeometry.setAttribute("position", new THREE.BufferAttribute(orbitPoints, 3));
        orbitLine.visible = true;
      }
    };

    worker.onerror = () => {
      if (!disposed) onStatus("轨道计算器不可用 · 请刷新页面重试");
    };

    const fetchGroup = async (group: string, forceRefresh = false): Promise<LoadedGroup> => {
      try {
        const refreshQuery = forceRefresh ? `&refresh=${Date.now()}` : "";
        const response = await fetch(`/api/tle?group=${group}${refreshQuery}`, {
          signal: dataAbortController.signal,
          cache: forceRefresh ? "no-store" : "default",
        });
        if (!response.ok) throw new Error("轨道服务不可用");
        const text = await response.text();
        const fallbackMetadata = parseTleMetadata(text);
        const source = response.headers.get("x-orbital-source") === "celestrak-live" ? "live" : "snapshot";
        const recordCount = Number.parseInt(response.headers.get("x-orbital-record-count") ?? "", 10);
        const epochValue = response.headers.get("x-orbital-tle-epoch-max");
        const servedAtValue = response.headers.get("x-orbital-served-at");
        return {
          group,
          text,
          source,
          recordCount: Number.isFinite(recordCount) ? recordCount : fallbackMetadata.recordCount,
          tleEpoch: epochValue ? Date.parse(epochValue) : fallbackMetadata.newestEpoch,
          servedAt: servedAtValue ? Date.parse(servedAtValue) : Date.now(),
        };
      } catch {
        const response = await fetch(`/tle/${group}.tle`, { signal: dataAbortController.signal });
        if (!response.ok) throw new Error("本地快照不可用");
        const text = await response.text();
        const metadata = parseTleMetadata(text);
        return {
          group,
          text,
          source: "snapshot",
          recordCount: metadata.recordCount,
          tleEpoch: metadata.newestEpoch,
          servedAt: Date.now(),
        };
      }
    };

    const loadOrbitData = async (forceRefresh = false) => {
      const requestId = ++dataRequestId;
      onDataStatus(ORBIT_GROUP_IDS.map((group) => ({ group, source: "loading" })));
      onStatus(forceRefresh ? "正在向 CelesTrak 强制更新轨道数据" : "正在更新轨道数据");
      const settled = await Promise.allSettled(ORBIT_GROUP_IDS.map((group) => fetchGroup(group, forceRefresh)));
      if (disposed || requestId !== dataRequestId) return;

      const groups: LoadedGroup[] = [];
      const statuses: OrbitGroupStatus[] = settled.map((result, index) => {
        const group = ORBIT_GROUP_IDS[index];
        if (result.status === "fulfilled") {
          groups.push(result.value);
          return {
            group,
            source: result.value.source,
            recordCount: result.value.recordCount,
            tleEpoch: result.value.tleEpoch,
            servedAt: result.value.servedAt,
          };
        }
        return {
          group,
          source: "failed",
          error: result.reason instanceof Error ? result.reason.message : "加载失败",
        };
      });

      onDataStatus(statuses);
      if (!groups.length) {
        onReady([]);
        onStatus("轨道数据暂不可用");
        return;
      }

      const liveCount = groups.filter((group) => group.source === "live").length;
      dataSummary = liveCount === groups.length
        ? "LIVE"
        : liveCount
          ? "MIXED"
          : "SNAPSHOT";
      worker.postMessage({ type: "load", groups });
    };

    onApi({ focus, clear, resetTime, setTime, setAutoRotate, setCoverageVisible, reload: () => { void loadOrbitData(true); } });
    void loadOrbitData();

    const pointer = new THREE.Vector2();
    const pointerStart = new THREE.Vector2();
    const projected = new THREE.Vector3();
    const worldPosition = new THREE.Vector3();
    const earthBounds = new THREE.Sphere(new THREE.Vector3(), 1);
    const sightLine = new THREE.Ray();
    const onPointerDown = (event: PointerEvent) => {
      pointerStart.set(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!renderedPositions || pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(event.clientX - rect.left, event.clientY - rect.top);
      let closestIndex = -1;
      let closestDistance = 18;

          satellites.forEach((satellite, index) => {
            if (!activeGroupsRef.current.has(satellite.group)) return;
            readVisualPosition(worldPosition, index);
        sightLine.set(camera.position, worldPosition.clone().sub(camera.position).normalize());
        const obstruction = sightLine.intersectSphere(earthBounds, projected);
        if (obstruction && camera.position.distanceTo(obstruction) < camera.position.distanceTo(worldPosition) - 0.01) return;

        projected.copy(worldPosition).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        const screenX = ((projected.x + 1) / 2) * rect.width;
        const screenY = ((1 - projected.y) / 2) * rect.height;
        const distance = pointer.distanceTo(new THREE.Vector2(screenX, screenY));
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      if (closestIndex >= 0) focus(closestIndex);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", resize);

    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      if (renderedPositions && nowPositions && nextPositions) {
        const progress = THREE.MathUtils.clamp((performance.now() - frameStart) / frameDuration, 0, 1);
        for (let index = 0; index < renderedPositions.length; index += 1) {
          renderedPositions[index] = THREE.MathUtils.lerp(nowPositions[index], nextPositions[index], progress);
        }
            syncPointLayerPositions();
            if (selectedIndex >= 0) {
              readVisualPosition(marker.position, selectedIndex);
              updateCoverage(selectedIndex);
        }
      }
      if (focusTarget) {
        camera.position.lerp(focusTarget, 0.035);
        if (camera.position.distanceTo(focusTarget) < 0.02) focusTarget = null;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      coastlineAbortController.abort();
      dataAbortController.abort();
      window.clearTimeout(updateTimer);
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", handleReducedMotionChange);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      worker.terminate();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = mesh.material
          ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          : [];
        materials.forEach((material) => material.dispose());
      });
      earth.textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      pointTextures.forEach((texture) => texture.dispose());
      renderer.domElement.remove();
      recolorRef.current = null;
    };
  }, [onApi, onDataStatus, onReady, onSelect, onStatus, onTime]);

  return <div ref={containerRef} className="globe-scene" aria-label="可交互的三维地球卫星轨迹" />;
}
