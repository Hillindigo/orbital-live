"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GlobeScene,
  type GlobeSceneApi,
  type OrbitGroupStatus,
  type SatelliteMeta,
  type SatelliteSnapshot,
} from "./components/GlobeScene";

const GROUPS = [
  { id: "starlink", label: "Starlink", color: "#73e6ff", shape: "circle" },
  { id: "gps-ops", label: "GPS", color: "#ffd36a", shape: "diamond" },
  { id: "stations", label: "空间站", color: "#ff7f66", shape: "station" },
] as const;
const TIMELINE_WINDOW_MS = 12 * 60 * 60 * 1000;

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

function formatDataAge(epoch?: number) {
  if (!epoch) return "历元未知";
  const hours = Math.max(0, Math.round((Date.now() - epoch) / 3_600_000));
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

export default function Home() {
  const [activeGroups, setActiveGroups] = useState<Set<string>>(
    () => new Set(GROUPS.map((group) => group.id)),
  );
  const [satellites, setSatellites] = useState<SatelliteMeta[]>([]);
  const [selected, setSelected] = useState<SatelliteSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [simulationTime, setSimulationTime] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [status, setStatus] = useState("正在连接轨道数据");
  const [dataStatuses, setDataStatuses] = useState<OrbitGroupStatus[]>(
    () => GROUPS.map((group) => ({ group: group.id, source: "loading" })),
  );
  const [sceneApi, setSceneApi] = useState<GlobeSceneApi | null>(null);
  const [timelineStart, setTimelineStart] = useState(() => Date.now() - TIMELINE_WINDOW_MS / 2);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleGlobalKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key === "r" || event.key === "R") {
        sceneApi?.resetTime();
      } else if (["1", "2", "3"].includes(event.key)) {
        setSpeed(Number(event.key === "1" ? 1 : event.key === "2" ? 10 : 60));
      }
    };
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [sceneApi]);

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
  const timelineEnd = timelineStart + TIMELINE_WINDOW_MS;
  const timelineValue = simulationTime === null
    ? timelineStart + TIMELINE_WINDOW_MS / 2
    : Math.min(timelineEnd, Math.max(timelineStart, simulationTime));

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
      .sort((a, b) => {
        const aExact = a.norad === normalized || a.name.toLowerCase() === normalized;
        const bExact = b.norad === normalized || b.name.toLowerCase() === normalized;
        return Number(bExact) - Number(aExact) || a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }, [query, satellites]);

  const statusByGroup = useMemo(
    () => new Map(dataStatuses.map((item) => [item.group, item])),
    [dataStatuses],
  );

  const toggleGroup = (group: string) => {
    setActiveGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const selectFromSearch = (satellite: SatelliteMeta) => {
    if (sceneApi?.focus(satellite.index)) {
      setQuery("");
      setSearchIndex(0);
    }
  };

  const setTimelineTime = (time: number) => {
    if (time < timelineStart || time > timelineEnd) {
      setTimelineStart(time - TIMELINE_WINDOW_MS / 2);
    }
    sceneApi?.setTime(time);
    setSimulationTime(time);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchIndex((current) => Math.min(current + 1, searchResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectFromSearch(searchResults[searchIndex] ?? searchResults[0]);
    } else if (event.key === "Escape") {
      setQuery("");
      setSearchIndex(0);
    }
  };

  const webglUnavailable = status.startsWith("WebGL");
  const dataUnavailable = status === "轨道数据暂不可用";

  return (
    <main className="orbital-app">
      <GlobeScene
        activeGroups={activeGroups}
        speed={speed}
        playing={playing}
        onReady={setSatellites}
        onSelect={setSelected}
        onStatus={setStatus}
        onDataStatus={setDataStatuses}
        onTime={setSimulationTime}
        onApi={setSceneApi}
      />

      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <div className="brand" aria-label="Orbital Live">
          <span className="brand-mark"><i /></span>
          <span>ORBITAL<span className="brand-thin">/LIVE</span></span>
        </div>
        <div className="data-status" role="status" aria-live="polite">
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
        <p className="eyebrow">低地球轨道 · TLE 轨道推算</p>
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="名称或 NORAD ID"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={searchResults.length > 0}
                aria-controls="satellite-search-results"
                aria-activedescendant={searchResults.length ? `satellite-option-${searchResults[searchIndex]?.index}` : undefined}
              />
            <kbd>/</kbd>
          </div>
          {searchResults.length > 0 && (
            <div className="search-results" id="satellite-search-results" role="listbox" aria-label="卫星搜索结果">
              {searchResults.map((satellite, index) => (
                <button
                  key={satellite.index}
                  id={`satellite-option-${satellite.index}`}
                  role="option"
                  aria-selected={index === searchIndex}
                  className={index === searchIndex ? "active" : ""}
                  onMouseEnter={() => setSearchIndex(index)}
                  onClick={() => selectFromSearch(satellite)}
                >
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
              <span className={`group-swatch ${group.shape}`} style={{ "--swatch": group.color } as React.CSSProperties} />
              <span>{group.label}</span>
              <strong>{(counts[group.id] ?? 0).toLocaleString("zh-CN")}</strong>
              <i className="toggle"><b /></i>
            </button>
          ))}
        </div>
        <section className="data-health" aria-label="轨道数据状态" aria-live="polite">
          <div className="data-health-heading">
            <span>数据状态</span>
            <button type="button" onClick={() => sceneApi?.reload()} disabled={!sceneApi}>重新加载</button>
          </div>
          {GROUPS.map((group) => {
            const groupStatus = statusByGroup.get(group.id);
            const label = groupStatus?.source === "live"
              ? "LIVE"
              : groupStatus?.source === "snapshot"
                ? "SNAPSHOT"
                : groupStatus?.source === "failed"
                  ? "FAILED"
                  : "LOADING";
            return (
              <div className={`data-health-row ${groupStatus?.source ?? "loading"}`} key={group.id}>
                <span>{group.label}</span>
                <strong>{label}</strong>
                <small>{groupStatus?.source === "failed" ? groupStatus.error : formatDataAge(groupStatus?.tleEpoch)}</small>
              </div>
            );
          })}
        </section>
      </section>

      {(webglUnavailable || dataUnavailable) && (
        <section className="scene-message glass-panel" role="alert">
          <h2>{webglUnavailable ? "无法启动三维地球" : "轨道数据暂不可用"}</h2>
          <p>{webglUnavailable ? "请开启浏览器硬件加速后刷新页面；数据面板仍会保留当前状态。" : "请检查网络后重新加载轨道数据。"}</p>
          {!webglUnavailable && <button type="button" onClick={() => sceneApi?.reload()}>重新加载数据</button>}
        </section>
      )}

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
              <div><small>TLE 历元</small><strong>{selected.epochTime ? new Date(selected.epochTime).toLocaleString("zh-CN") : "未知"}</strong></div>
            </div>
            <div className="pass-bar"><span>轨道周期</span><b>{selected.period.toFixed(1)} 分钟</b></div>
            <p className="card-hint">位置为基于 TLE 的 SGP4 推算；白色轨迹为未来一个轨道周期。可直接从搜索结果切换目标。</p>
          </>
        ) : (
          <div className="empty-selection"><span className="reticle" /><p>选择一个卫星光点<br /><small>查看轨道推算与预测路径</small></p></div>
        )}
      </section>

      <section className="timeline glass-panel" aria-label="时间控制">
        <button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停模拟时间（空格）" : "播放模拟时间（空格）"}>
          <span className={playing ? "pause-icon" : "play-icon"} />
        </button>
        <div className="timeline-main">
          <div className="timeline-labels"><span>模拟时间</span><strong>{clock ? `${formatDate(clock)} ${formatClock(clock)}` : "--:--:--"} <small>LOCAL</small></strong></div>
          <input
            className="timeline-range"
            type="range"
            min={timelineStart}
            max={timelineEnd}
            step={60_000}
            value={timelineValue}
            onChange={(event) => setTimelineTime(Number(event.target.value))}
            aria-label="在 12 小时窗口内调整模拟时间"
          />
        </div>
        <div className="speed-control">
          <button type="button" onClick={() => setTimelineTime((simulationTime ?? Date.now()) - 3_600_000)} title="向前一小时">−1h</button>
          <button className="now-button" onClick={() => sceneApi?.resetTime()} title="回到当前时间（R）">现在</button>
          <button type="button" onClick={() => setTimelineTime((simulationTime ?? Date.now()) + 3_600_000)} title="向后一小时">+1h</button>
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
