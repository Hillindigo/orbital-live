"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlobeScene, type SatelliteMeta, type SatelliteSnapshot } from "./components/GlobeScene";

const GROUPS = [
  { id: "starlink", label: "Starlink", color: "#73e6ff" },
  { id: "gps-ops", label: "GPS", color: "#ffd36a" },
  { id: "stations", label: "空间站", color: "#ff7f66" },
] as const;

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export default function Home() {
  const [activeGroups, setActiveGroups] = useState<Set<string>>(
    () => new Set(GROUPS.map((group) => group.id)),
  );
  const [satellites, setSatellites] = useState<SatelliteMeta[]>([]);
  const [selected, setSelected] = useState<SatelliteSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [simulationTime, setSimulationTime] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [status, setStatus] = useState("正在连接轨道数据");
  const [sceneApi, setSceneApi] = useState<{
    focus: (index: number) => boolean;
    clear: () => void;
    resetTime: () => void;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!selected || !sceneApi) return;
    const cancelTracking = (event: KeyboardEvent) => {
      if (event.key === "Escape") sceneApi.clear();
    };
    window.addEventListener("keydown", cancelTracking);
    return () => window.removeEventListener("keydown", cancelTracking);
  }, [sceneApi, selected]);

  const clock = simulationTime === null ? null : new Date(simulationTime);
  const timelineProgress = clock ? 28 + ((clock.getSeconds() / 60) * 58) : 28;

  const counts = useMemo(() => {
    const output: Record<string, number> = {};
    satellites.forEach((satellite) => {
      output[satellite.group] = (output[satellite.group] ?? 0) + 1;
    });
    return output;
  }, [satellites]);

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return satellites
      .filter((satellite) =>
        `${satellite.name} ${satellite.norad}`.toLowerCase().includes(normalized),
      )
      .slice(0, 6);
  }, [query, satellites]);

  const toggleGroup = (group: string) => {
    setActiveGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const selectFromSearch = (satellite: SatelliteMeta) => {
    if (selected) return;
    if (sceneApi?.focus(satellite.index)) setQuery("");
  };

  return (
    <main className="orbital-app">
      <GlobeScene
        activeGroups={activeGroups}
        speed={speed}
        playing={playing}
        onReady={setSatellites}
        onSelect={setSelected}
        onStatus={setStatus}
        onTime={setSimulationTime}
        onApi={setSceneApi}
      />

      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <div className="brand" aria-label="Orbital Live">
          <span className="brand-mark"><i /></span>
          <span>ORBITAL<span className="brand-thin">/LIVE</span></span>
        </div>
        <div className="data-status">
          <span className="status-dot" />
          <span>{status}</span>
          <span className="status-divider" />
          <span>SGP4 本地推算</span>
        </div>
        <div className="utc-clock">
          <span>{clock ? formatDate(clock) : "正在同步时间"}</span>
          <strong>{clock ? formatClock(clock) : "--:--:--"}</strong>
        </div>
      </header>

      <section className="mission-panel glass-panel" aria-label="轨道控制">
        <p className="eyebrow">低地球轨道 · 实时态势</p>
        <h1>看见地球<br /><em>正在发生</em>的轨道</h1>
        <p className="lede">
          基于最新 TLE 根数，在你的浏览器中逐秒推算全球卫星位置。
          拖动地球，选择任意光点进入跟踪。
        </p>

        <div className="search-wrap">
          <label htmlFor="sat-search">搜索卫星</label>
          <div className="search-field">
            <span className="search-glyph" aria-hidden="true" />
            <input
              id="sat-search"
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称或 NORAD ID"
              autoComplete="off"
            />
            <kbd>/</kbd>
          </div>
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((satellite) => (
                <button key={satellite.index} onClick={() => selectFromSearch(satellite)}>
                  <span>{satellite.name}</span>
                  <small>{satellite.norad}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="group-list" aria-label="星座筛选">
          {GROUPS.map((group) => (
            <button
              key={group.id}
              className={activeGroups.has(group.id) ? "group-row active" : "group-row"}
              onClick={() => toggleGroup(group.id)}
              aria-pressed={activeGroups.has(group.id)}
            >
              <span className="group-swatch" style={{ "--swatch": group.color } as React.CSSProperties} />
              <span>{group.label}</span>
              <strong>{(counts[group.id] ?? 0).toLocaleString("zh-CN")}</strong>
              <i className="toggle"><b /></i>
            </button>
          ))}
        </div>
      </section>

      <section className={selected ? "satellite-card glass-panel visible" : "satellite-card glass-panel"} aria-live="polite">
        {selected ? (
          <>
            <div className="card-heading">
              <span className="tracking-pulse" />
              <div><small>正在跟踪</small><h2>{selected.name}</h2></div>
              <div className="card-actions">
                <span className="norad">#{selected.norad}</span>
                <button type="button" onClick={() => sceneApi?.clear()} aria-label="取消追踪">×</button>
              </div>
            </div>
            <div className="telemetry-grid">
              <div><small>高度</small><strong>{Math.round(selected.altitude).toLocaleString()}<span> km</span></strong></div>
              <div><small>速度</small><strong>{selected.velocity.toFixed(2)}<span> km/s</span></strong></div>
              <div><small>纬度</small><strong>{Math.abs(selected.latitude).toFixed(2)}°<span> {selected.latitude >= 0 ? "N" : "S"}</span></strong></div>
              <div><small>经度</small><strong>{Math.abs(selected.longitude).toFixed(2)}°<span> {selected.longitude >= 0 ? "E" : "W"}</span></strong></div>
            </div>
            <div className="satellite-facts" aria-label="卫星简介">
              <div><small>归属国家/地区</small><strong>{selected.country}</strong></div>
              <div><small>运营方</small><strong>{selected.operator}</strong></div>
              <div><small>发射年份</small><strong>{selected.launchYear ?? "未知"}</strong></div>
            </div>
            <div className="pass-bar"><span>轨道周期</span><b>{selected.period.toFixed(1)} 分钟</b></div>
            <p className="card-hint">简介来自 TLE 国际标识符与公开星座分类；白色轨迹为未来一个轨道周期。取消追踪后才能选择其他卫星。</p>
          </>
        ) : (
          <div className="empty-selection"><span className="reticle" /><p>选择一个卫星光点<br /><small>查看实时遥测与轨道路径</small></p></div>
        )}
      </section>

      <section className="timeline glass-panel" aria-label="时间控制">
        <button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停" : "播放"}>
          <span className={playing ? "pause-icon" : "play-icon"} />
        </button>
        <div className="timeline-main">
          <div className="timeline-labels"><span>模拟时间</span><strong>{clock ? formatClock(clock) : "--:--:--"} <small>LOCAL</small></strong></div>
          <div className="track"><i style={{ width: `${timelineProgress}%` }} /><b style={{ left: `${timelineProgress}%` }} /></div>
        </div>
        <div className="speed-control">
          <button className="now-button" onClick={() => sceneApi?.resetTime()}>现在</button>
          {[1, 10, 60].map((value) => (
            <button key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
        </div>
      </section>

      <div className="gesture-hint"><span className="mouse-shape" /><p>拖动旋转 · 滚轮缩放 · 点击跟踪</p></div>
      <footer><span>EARTH / WGS84</span><span>NIGHT LIGHTS · NASA BLACK MARBLE 2016</span><span>DATA · CELESTRAK</span><span>PROPAGATION · SATELLITE.JS</span></footer>
    </main>
  );
}
