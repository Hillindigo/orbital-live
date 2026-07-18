"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type SatelliteMeta = {
  index: number;
  name: string;
  norad: string;
  group: string;
  period: number;
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
  onApi: (api: { focus: (index: number) => void; clear: () => void }) => void;
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

function createEarth() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 96, 64);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      lightDirection: { value: new THREE.Vector3(-1.4, 0.35, 1).normalize() },
    },
    vertexShader: `
      varying vec3 vNormalWorld;
      varying vec3 vPositionWorld;
      void main() {
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vPositionWorld = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 lightDirection;
      varying vec3 vNormalWorld;
      varying vec3 vPositionWorld;
      void main() {
        float daylight = smoothstep(-0.18, 0.62, dot(normalize(vNormalWorld), lightDirection));
        float polar = pow(abs(vNormalWorld.y), 3.0);
        vec3 night = vec3(0.006, 0.026, 0.045);
        vec3 day = vec3(0.018, 0.105, 0.155);
        vec3 ice = vec3(0.24, 0.48, 0.54) * polar * daylight * 0.42;
        vec3 color = mix(night, day, daylight) + ice;
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
  return group;
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
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    scene.add(createStars());
    scene.add(createEarth());
    scene.add(createGraticule());
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
    let frameStart = performance.now();
    let frameDuration = 1000;
    let disposed = false;
    let simulationTime = Date.now();
    let lastRealTime = performance.now();
    let focusTarget: THREE.Vector3 | null = null;
    let updateTimer = 0;
    let frameRequestedAt = 0;
    let dataSource: "live" | "snapshot" = "live";

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
      if (!satellites[index] || !renderedPositions) return;
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
    };
    const clear = () => {
      selectedIndex = -1;
      marker.visible = false;
      orbitLine.visible = false;
      coverageLine.visible = false;
      focusTarget = null;
      onSelect(null);
    };
    onApi({ focus, clear });

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
        onStatus(`${dataSource === "live" ? "LIVE" : "SNAPSHOT"} · ${satellites.length.toLocaleString("zh-CN")} 颗目标`);
        requestFrame();
      } else if (message.type === "frame") {
        nowPositions = message.now;
        nextPositions = message.next;
        telemetry = message.telemetry;
        frameStart = performance.now();
        frameDuration = Math.max(250, message.nextTime - message.time) / Math.max(speedRef.current, 1);
        if (!renderedPositions || renderedPositions.length !== nowPositions!.length) {
          renderedPositions = nowPositions!.slice();
          pointsGeometry.setAttribute("position", new THREE.BufferAttribute(renderedPositions, 3));
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
        return { group, text: await response.text(), live };
      } catch {
        const response = await fetch(`/tle/${group}.tle`);
        if (!response.ok) throw new Error(`snapshot unavailable: ${group}`);
        return { group, text: await response.text(), live: false };
      }
    })).then((groups) => {
      dataSource = groups.every((group) => group.live) ? "live" : "snapshot";
      if (!disposed) worker.postMessage({ type: "load", groups });
    }).catch(() => {
      if (!disposed) onStatus("轨道数据暂不可用");
    });

    const pointer = new THREE.Vector2();
    const pointerStart = new THREE.Vector2();
    const projected = new THREE.Vector3();
    const worldPosition = new THREE.Vector3();
    const earth = new THREE.Sphere(new THREE.Vector3(), 1);
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
        const obstruction = sightLine.intersectSphere(earth, projected);
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
      renderer.dispose();
      pointTexture.dispose();
      renderer.domElement.remove();
      recolorRef.current = null;
    };
  }, [onApi, onReady, onSelect, onStatus, onTime]);

  return <div ref={containerRef} className="globe-scene" aria-label="可交互的三维地球卫星轨迹" />;
}
