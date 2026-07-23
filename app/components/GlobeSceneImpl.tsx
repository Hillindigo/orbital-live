"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { feature, mesh } from "topojson-client";
import countriesAtlas from "world-atlas/countries-110m.json";

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

export type GlobeSceneProps = {
  activeGroups: Set<string>;
  speed: number;
  playing: boolean;
  onReady: (satellites: SatelliteMeta[]) => void;
  onSelect: (satellite: SatelliteSnapshot | null) => void;
  onStatus: (status: string) => void;
  onTime: (time: number) => void;
  onApi: (api: { focus: (index: number) => boolean; clear: () => void; resetTime: () => void }) => void;
};

const GROUP_COLORS: Record<string, THREE.Color> = {
  starlink: new THREE.Color("#73e6ff"),
  "gps-ops": new THREE.Color("#ffd36a"),
  stations: new THREE.Color("#ff7f66"),
};

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

export function GlobeScene({ activeGroups, speed, playing, onReady, onSelect, onStatus, onTime, onApi }: GlobeSceneProps) {
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
    const abortController = new AbortController();
    void addCoastlines(scene, abortController.signal);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.65;
    controls.maxDistance = 6.5;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    controls.autoRotate = !reducedMotion.matches;

    const pointTexture = makePointTexture();
    const pointsGeometry = new THREE.BufferGeometry();
    const pointsMaterial = new THREE.PointsMaterial({
      size: 0.035,
      map: pointTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      alphaTest: 0.02,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(points);

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
      map: pointTexture,
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
    let autoRotateBeforeFocus = controls.autoRotate;
    let frameStart = performance.now();
    let frameDuration = 1000;
    let disposed = false;
    let simulationTime = Date.now();
    let lastRealTime = performance.now();
    let focusTarget: THREE.Vector3 | null = null;
    let updateTimer = 0;
    let frameRequestedAt = 0;
    let dataSource: "live" | "snapshot" = "live";
    let dataFetchedAt: string | null = null;

    const applyColors = () => {
      if (!satellites.length) return;
      const colors = new Float32Array(satellites.length * 3);
      satellites.forEach((satellite, index) => {
        const color = activeGroupsRef.current.has(satellite.group)
          ? GROUP_COLORS[satellite.group] ?? new THREE.Color(0xffffff)
          : new THREE.Color(0x000000);
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
      });
      pointsGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    };
    recolorRef.current = applyColors;

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
      coverageLine.visible = true;
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
      if (selectedIndex >= 0) return false;
      if (!renderedPositions) {
        pendingFocusIndex = index;
        return true;
      }
      cameraBeforeFocus = camera.position.clone();
      targetBeforeFocus = controls.target.clone();
      autoRotateBeforeFocus = controls.autoRotate;
      selectedIndex = index;
      controls.autoRotate = false;
      marker.visible = true;
      orbitLine.visible = false;
      emitSelection(index);
      updateCoverage(index);
      const position = new THREE.Vector3(
        renderedPositions[index * 3],
        renderedPositions[index * 3 + 1],
        renderedPositions[index * 3 + 2],
      );
      focusTarget = position.clone().normalize().multiplyScalar(2.7);
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
      controls.autoRotate = autoRotateBeforeFocus;
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
    onApi({ focus, clear, resetTime });

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
        applyColors();
        const fetchedLabel = dataFetchedAt
          ? ` · ${new Date(dataFetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
          : "";
        onStatus(`${dataSource === "live" ? "LIVE" : "SNAPSHOT"} · ${satellites.length.toLocaleString("zh-CN")} 颗目标${fetchedLabel}`);
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
          pointsGeometry.setAttribute("position", new THREE.BufferAttribute(renderedPositions, 3));
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
        orbitGeometry.setAttribute("position", new THREE.BufferAttribute(message.points, 3));
        orbitLine.visible = true;
      }
    };

    Promise.all(["starlink", "gps-ops", "stations"].map(async (group) => {
      try {
        const response = await fetch(`/api/tle?group=${group}`);
        if (!response.ok) throw new Error("live unavailable");
        const live = response.headers.get("x-orbital-source") === "celestrak-live";
        return {
          group,
          text: await response.text(),
          live,
          fetchedAt: response.headers.get("x-orbital-fetched-at"),
        };
      } catch {
        const response = await fetch(`/tle/${group}.tle`);
        if (!response.ok) throw new Error(`snapshot unavailable: ${group}`);
        return {
          group,
          text: await response.text(),
          live: false,
          fetchedAt: response.headers.get("x-orbital-fetched-at"),
        };
      }
    })).then((groups) => {
      dataSource = groups.every((group) => group.live) ? "live" : "snapshot";
      dataFetchedAt = groups.map((group) => group.fetchedAt).find(Boolean) ?? null;
      if (!disposed) worker.postMessage({ type: "load", groups });
    }).catch(() => {
      if (!disposed) onStatus("轨道数据暂不可用");
    });

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
        worldPosition.fromArray(renderedPositions!, index * 3);
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
        pointsGeometry.attributes.position.needsUpdate = true;
        if (selectedIndex >= 0) {
          marker.position.fromArray(renderedPositions, selectedIndex * 3);
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
      abortController.abort();
      window.clearTimeout(updateTimer);
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
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
      pointTexture.dispose();
      renderer.domElement.remove();
      recolorRef.current = null;
    };
  }, [onApi, onReady, onSelect, onStatus, onTime]);

  return <div ref={containerRef} className="globe-scene" aria-label="可交互的三维地球卫星轨迹" />;
}
