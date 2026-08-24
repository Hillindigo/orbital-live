"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GlobeScene,
  type GlobeSceneApi,
  type OrbitGroupStatus,
  type SatelliteMeta,
  type SatelliteSnapshot,
} from "./components/GlobeScene";
import { ORBIT_GROUPS } from "./lib/orbit-groups";
import {
  addFavorite,
  addRecent,
  clearRecent,
  isFavorite,
  readFavorites,
  readRecent,
  removeFavorite,
  type FavoriteSatellite,
  type RecentSatellite,
} from "./lib/satellite-library.mjs";

const TIMELINE_WINDOW_MS = 12 * 60 * 60 * 1000;
const ONBOARDING_STORAGE_KEY = "orbital-onboarding-complete";
type UiLayout = { autoRotate: boolean; leftPanelVisible: boolean; detailPanelVisible: boolean };
const DEFAULT_UI_LAYOUT: UiLayout = { autoRotate: true, leftPanelVisible: true, detailPanelVisible: true };

function readUiLayout(): UiLayout {
  if (typeof window === "undefined") return DEFAULT_UI_LAYOUT;
  try {
    const saved = window.localStorage.getItem("orbital-ui-layout");
    if (!saved) return DEFAULT_UI_LAYOUT;
    const layout = JSON.parse(saved) as Partial<UiLayout>;
    return {
      autoRotate: typeof layout.autoRotate === "boolean" ? layout.autoRotate : true,
      leftPanelVisible: typeof layout.leftPanelVisible === "boolean" ? layout.leftPanelVisible : true,
      detailPanelVisible: typeof layout.detailPanelVisible === "boolean" ? layout.detailPanelVisible : true,
    };
  } catch {
    return DEFAULT_UI_LAYOUT;
  }
}

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

function formatRefreshAge(servedAt?: number) {
  if (!servedAt || !Number.isFinite(servedAt)) return "刷新时间未知";
  const minutes = Math.max(0, Math.floor((Date.now() - servedAt) / 60_000));
  if (minutes < 1) return "刚刚刷新";
  if (minutes < 60) return `${minutes} 分钟前刷新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前刷新`;
  return `${Math.floor(hours / 24)} 天前刷新`;
}

function getDataFreshness(epoch?: number) {
  if (!epoch || !Number.isFinite(epoch)) return "unknown";
  const ageHours = Math.max(0, (Date.now() - epoch) / 3_600_000);
  if (ageHours <= 24) return "fresh";
  if (ageHours <= 72) return "aging";
  return "stale";
}

export default function Home() {
  const [activeGroups, setActiveGroups] = useState<Set<string>>(
    () => new Set(ORBIT_GROUPS.map((group) => group.id)),
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
    () => ORBIT_GROUPS.map((group) => ({ group: group.id, source: "loading" })),
  );
  const [sceneApi, setSceneApi] = useState<GlobeSceneApi | null>(null);
  const [timelineStart, setTimelineStart] = useState(() => Date.now() - TIMELINE_WINDOW_MS / 2);
  const [autoRotate, setAutoRotate] = useState(() => readUiLayout().autoRotate);
  const [coverageVisible, setCoverageVisible] = useState(true);
  const [leftPanelVisible, setLeftPanelVisible] = useState(() => readUiLayout().leftPanelVisible);
  const [detailPanelVisible, setDetailPanelVisible] = useState(() => readUiLayout().detailPanelVisible);
  const [favorites, setFavorites] = useState<FavoriteSatellite[]>(() => (
    typeof window === "undefined" ? [] : readFavorites(window.localStorage)
  ));
  const [recent, setRecent] = useState<RecentSatellite[]>(() => (
    typeof window === "undefined" ? [] : readRecent(window.localStorage)
  ));
  const [libraryView, setLibraryView] = useState<"search" | "favorites" | "recent">("search");
  const [onboardingVisible, setOnboardingVisible] = useState(() => (
    typeof window === "undefined" || window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "true"
  ));
  const detailPanelManuallyHiddenRef = useRef(!readUiLayout().detailPanelVisible);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.localStorage.setItem("orbital-ui-layout", JSON.stringify({ autoRotate, leftPanelVisible, detailPanelVisible }));
  }, [autoRotate, detailPanelVisible, leftPanelVisible]);


  useEffect(() => {
    sceneApi?.setAutoRotate(autoRotate);
  }, [autoRotate, sceneApi]);

  useEffect(() => {
    sceneApi?.setCoverageVisible(coverageVisible);
  }, [coverageVisible, sceneApi]);

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

  const favoriteRows = useMemo(() => favorites.map((favorite) => ({
    favorite,
    satellite: satellites.find((satellite) => satellite.norad === favorite.norad),
  })), [favorites, satellites]);
  const recentRows = useMemo(() => recent.map((item) => ({
    item,
    satellite: satellites.find((satellite) => satellite.norad === item.norad),
  })), [recent, satellites]);

  const toggleFavorite = (satellite: SatelliteMeta) => {
    const storage = window.localStorage;
    setFavorites(isFavorite(favorites, satellite.norad)
      ? removeFavorite(storage, satellite.norad)
      : addFavorite(storage, satellite));
  };

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

  const closeOnboarding = () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setOnboardingVisible(false);
  };

  const startDemo = (kind: "iss" | "gps") => {
    if (kind === "gps") {
      setActiveGroups(new Set(["gps-ops"]));
      closeOnboarding();
      return;
    }
    const target = satellites.find((satellite) => satellite.norad === "25544")
      ?? satellites.find((satellite) => satellite.name.toLowerCase().includes("iss"));
    if (target) selectFromSearch(target);
    closeOnboarding();
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
  const handleSatelliteSelect = useCallback((satellite: SatelliteSnapshot | null) => {
    setSelected(satellite);
    if (satellite) {
      setRecent(addRecent(window.localStorage, satellite));
      if (!detailPanelManuallyHiddenRef.current) setDetailPanelVisible(true);
    }
  }, []);

  return (
    <main className="orbital-app">
      <GlobeScene
        activeGroups={activeGroups}
        speed={speed}
        playing={playing}
        onReady={setSatellites}
        onSelect={handleSatelliteSelect}
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
          <button type="button" className="help-button" onClick={() => setOnboardingVisible(true)} aria-label="打开使用引导" title="使用引导">?</button>
        </div>
      </header>

      {onboardingVisible && (
        <section className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <div className="onboarding-panel glass-panel">
            <p className="eyebrow">欢迎进入轨道视图</p>
            <h2 id="onboarding-title">三步认识 ORBITAL/LIVE</h2>
            <div className="onboarding-steps">
              <article><span>01</span><div><strong>拖动与缩放</strong><p>拖动地球改变视角，滚轮缩放轨道尺度。</p></div></article>
              <article><span>02</span><div><strong>点击卫星</strong><p>选择任意光点，查看遥测与未来轨道。</p></div></article>
              <article><span>03</span><div><strong>搜索与时间</strong><p>按名称或 NORAD ID 搜索，使用底部时间轴模拟。</p></div></article>
            </div>
            <div className="onboarding-demos">
              <button type="button" onClick={() => startDemo("iss")} disabled={!satellites.length}>跟踪 ISS</button>
              <button type="button" onClick={() => startDemo("gps")} disabled={!satellites.length}>浏览 GPS</button>
            </div>
            <button type="button" className="onboarding-close" onClick={closeOnboarding}>开始探索</button>
          </div>
        </section>
      )}

      <section className={leftPanelVisible ? "mission-panel glass-panel" : "mission-panel glass-panel panel-hidden"} aria-label="轨道控制">
        <p className="eyebrow">低地球轨道 · TLE 轨道推算</p>
        <h1>看见地球<br /><em>正在发生</em>的轨道</h1>
        <p className="lede">
          基于最新 TLE 根数，在你的浏览器中逐秒推算全球卫星位置。
          拖动地球，选择任意光点进入跟踪。
        </p>

        <div className="library-tabs" role="tablist" aria-label="卫星资料库">
          <button type="button" role="tab" aria-selected={libraryView === "search"} className={libraryView === "search" ? "active" : ""} onClick={() => setLibraryView("search")}>搜索</button>
          <button type="button" role="tab" aria-selected={libraryView === "favorites"} className={libraryView === "favorites" ? "active" : ""} onClick={() => setLibraryView("favorites")}>收藏 <span>{favorites.length}</span></button>
          <button type="button" role="tab" aria-selected={libraryView === "recent"} className={libraryView === "recent" ? "active" : ""} onClick={() => setLibraryView("recent")}>最近</button>
        </div>
        {libraryView === "search" ? <div className="search-wrap">
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
        </div> : libraryView === "favorites" ? (
          <section className="library-list" aria-label="收藏卫星">
            {favoriteRows.length ? favoriteRows.map(({ favorite, satellite }) => (
              <div className="library-row" key={favorite.norad}>
                <button type="button" onClick={() => satellite && selectFromSearch(satellite)} disabled={!satellite}>
                  <span>{satellite?.name ?? favorite.name}</span>
                  <small>#{favorite.norad}{satellite ? "" : " · 当前不可用"}</small>
                </button>
                <button type="button" className="library-remove" onClick={() => setFavorites(removeFavorite(window.localStorage, favorite.norad))} aria-label={`取消收藏 ${favorite.name}`}>×</button>
              </div>
            )) : <p className="library-empty">还没有收藏卫星<br /><small>选择卫星后点击星标即可收藏</small></p>}
            <p className="storage-note">收藏仅保存在当前浏览器中</p>
          </section>
        ) : (
          <section className="library-list" aria-label="最近查看">
            {recentRows.length ? recentRows.map(({ item, satellite }) => (
              <div className="library-row recent-row" key={item.norad}>
                <button type="button" onClick={() => satellite && selectFromSearch(satellite)} disabled={!satellite}>
                  <span>{satellite?.name ?? item.name}</span>
                  <small>#{item.norad}{satellite ? "" : " · 当前不可用"}</small>
                </button>
              </div>
            )) : <p className="library-empty">还没有查看记录<br /><small>点击或搜索选择卫星后会自动记录</small></p>}
            {recentRows.length > 0 && <button type="button" className="library-clear" onClick={() => setRecent(clearRecent(window.localStorage))}>清空最近查看</button>}
          </section>
        )}

        <div className="group-list" aria-label="星座筛选">
          {ORBIT_GROUPS.map((group) => (
            <button
              key={group.id}
              className={activeGroups.has(group.id) ? "group-row active" : "group-row"}
              onClick={() => toggleGroup(group.id)}
              aria-pressed={activeGroups.has(group.id)}
            >
              <span className={`group-swatch ${group.marker.shape}`} style={{ "--swatch": group.color } as React.CSSProperties} />
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
          {ORBIT_GROUPS.map((group) => {
            const groupStatus = statusByGroup.get(group.id);
            const label = groupStatus?.source === "live"
              ? "LIVE"
              : groupStatus?.source === "snapshot"
                ? "SNAPSHOT"
                : groupStatus?.source === "failed"
                  ? "FAILED"
                  : "LOADING";
            const isSnapshot = groupStatus?.source === "snapshot";
            const statusDetail = groupStatus?.source === "failed"
              ? groupStatus.error
              : isSnapshot
                ? formatRefreshAge(groupStatus?.servedAt)
                : formatDataAge(groupStatus?.tleEpoch);
            const statusTitle = isSnapshot
              ? `快照 TLE 历元：${formatDataAge(groupStatus?.tleEpoch)}；${formatRefreshAge(groupStatus?.servedAt)}`
              : undefined;
            const sourceDescription = groupStatus?.source === "live"
              ? "CelesTrak 在线数据"
              : groupStatus?.source === "snapshot"
                ? "项目内置快照"
                : "数据来源待确认";
            return (
              <div className={`data-health-row ${groupStatus?.source ?? "loading"} ${getDataFreshness(groupStatus?.tleEpoch)}`} key={group.id} title={`${sourceDescription}；${groupStatus?.recordCount?.toLocaleString("zh-CN") ?? 0} 条记录`}>
                <span>{group.label}</span>
                <strong>{label}</strong>
                <small title={statusTitle}>{statusDetail}</small>
              </div>
            );
          })}
          <details className="data-explanation">
            <summary>TLE 数据说明</summary>
            <p><b>LIVE</b> 为 CelesTrak 在线数据，<b>SNAPSHOT</b> 为项目内置快照。颜色表示 TLE 历元新鲜度：绿 ≤24 小时、黄 24–72 小时、红 ＞72 小时。</p>
            <p>页面位置、速度与轨迹由 TLE 经 SGP4 推算，并非卫星实时遥测；数据获取时间也不等于 TLE 观测历元。</p>
            <p>国家/地区与运营方由名称规则推断，仅作辅助分类，不代表权威登记信息。</p>
          </details>
        </section>
      </section>

      {(webglUnavailable || dataUnavailable) && (
        <section className="scene-message glass-panel" role="alert">
          <h2>{webglUnavailable ? "无法启动三维地球" : "轨道数据暂不可用"}</h2>
          <p>{webglUnavailable ? "请开启浏览器硬件加速后刷新页面；数据面板仍会保留当前状态。" : "请检查网络后重新加载轨道数据。"}</p>
          {!webglUnavailable && <button type="button" onClick={() => sceneApi?.reload()}>重新加载数据</button>}
        </section>
      )}

      <section className={`${selected ? "satellite-card glass-panel visible" : "satellite-card glass-panel"}${detailPanelVisible ? "" : " panel-hidden"}`} aria-live="polite">
        {selected ? (
          <>
            <div className="card-heading">
              <span className="tracking-pulse" />
              <div><small>正在跟踪</small><h2>{selected.name}</h2></div>
              <div className="card-actions">
                <span className="norad">#{selected.norad}</span>
                <button type="button" className={isFavorite(favorites, selected.norad) ? "favorite-button active" : "favorite-button"} onClick={() => toggleFavorite(selected)} aria-label={isFavorite(favorites, selected.norad) ? `取消收藏 ${selected.name}` : `收藏 ${selected.name}`} aria-pressed={isFavorite(favorites, selected.norad)} title={isFavorite(favorites, selected.norad) ? "取消收藏" : "收藏卫星"}>{isFavorite(favorites, selected.norad) ? "★" : "☆"}</button>
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
            <div className="coverage-control">
              <button type="button" onClick={() => setCoverageVisible((visible) => !visible)} aria-pressed={coverageVisible}>
                <i><b /></i><span>几何可见范围</span>
              </button>
              <p>青色圆圈表示卫星到几何地平线的范围，不是通信覆盖范围；未考虑天线、频率、地形与最低仰角。</p>
            </div>
            <p className="card-hint">位置为基于 TLE 的 SGP4 推算；白色轨迹为未来一个轨道周期。可直接从搜索结果切换目标。</p>
          </>
        ) : (
          <div className="empty-selection"><span className="reticle" /><p>选择一个卫星光点<br /><small>查看轨道推算与预测路径</small></p></div>
        )}
      </section>

      {!leftPanelVisible && (
        <button type="button" className="panel-peek left" onClick={() => setLeftPanelVisible(true)} aria-label="显示左侧控制面板">
          <span>控制</span>
        </button>
      )}
      {!detailPanelVisible && (
        <button type="button" className="panel-peek right" onClick={() => { detailPanelManuallyHiddenRef.current = false; setDetailPanelVisible(true); }} aria-label="显示卫星跟踪面板">
          <span>跟踪</span>
        </button>
      )}
      <section className="scene-controls glass-panel" aria-label="视图控制">
        <button
          type="button"
          className={autoRotate ? "active" : ""}
          onClick={() => setAutoRotate((enabled) => !enabled)}
          aria-pressed={autoRotate}
          title={autoRotate ? "关闭地球自动旋转" : "开启地球自动旋转"}
        ><span className="control-icon rotate" aria-hidden="true" />自转</button>
        <button
          type="button"
          className={leftPanelVisible ? "active" : ""}
          onClick={() => setLeftPanelVisible((visible) => !visible)}
          aria-pressed={leftPanelVisible}
          title={leftPanelVisible ? "隐藏左侧控制面板" : "显示左侧控制面板"}
        ><span className="control-icon left-panel" aria-hidden="true" />控制</button>
        <button
          type="button"
          className={detailPanelVisible ? "active" : ""}
          onClick={() => {
            setDetailPanelVisible((visible) => {
              detailPanelManuallyHiddenRef.current = visible;
              return !visible;
            });
          }}
          aria-pressed={detailPanelVisible}
          title={detailPanelVisible ? "隐藏卫星跟踪面板" : "显示卫星跟踪面板"}
        ><span className="control-icon right-panel" aria-hidden="true" />跟踪</button>
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
