# ORBITAL/LIVE

### Real-time 3D Satellite Tracker · 实时三维卫星轨道追踪器

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=06131f)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-000000?logo=three.js&logoColor=white)](https://threejs.org/)
[![SGP4](https://img.shields.io/badge/Orbit-SGP4-70e8f0)](https://github.com/shashwatak/satellite-js)
[![Deployment](https://img.shields.io/badge/Deploy-OpenAI%20Sites%20%2F%20Cloudflare-ff7f66)](https://orbital-live-earth.izhaankismet9932.chatgpt.site)

> Navigate live orbital data on a WebGL Earth: CelesTrak TLE → satellite.js SGP4 propagation → Three.js globe rendering.

[在线体验](https://orbital-live-earth.izhaankismet9932.chatgpt.site) · [功能特性](#功能特性) · [快速启动](#快速启动) · [数据流](#数据流) · [部署](#部署) · [English Summary](#english-summary)

---

## 项目状态

ORBITAL/LIVE 是一个可本地运行、可部署到 OpenAI Sites / Cloudflare Workers 的交互式卫星轨道可视化项目。当前实现重点是：实时 TLE 获取、离线快照降级、Web Worker 轨道传播、三维地球渲染、卫星筛选与遥测查看。

当前质量门禁：

```bash
npm run lint
npm test
```

`npm test` 会先执行生产构建，再验证应用 shell、TLE API 参数校验、元数据和降级行为。

## 功能特性

- **三维地球** — 基于 Three.js/WebGL 渲染地球、海岸线、国界线与轨道对象。
- **昼夜着色** — 根据实时太阳方向计算昼夜分界，夜面混合 NASA Black Marble 2016 夜间灯光纹理。
- **卫星追踪** — 支持 Starlink、GPS、空间站三组目标；点击卫星进入跟踪模式。
- **实时遥测** — 展示高度、速度、经纬度、轨道周期、发射年份、TLE 历元、国家/运营方分类。
- **时间模拟** — 支持暂停、回到当前时间，以及 1× / 10× / 60× 倍速播放。
- **搜索筛选** — 按卫星名称或 NORAD ID 搜索，按星座/分组开关显示。
- **轨道预测** — 选中卫星后绘制未来一个轨道周期的预测轨迹线。
- **数据降级** — CelesTrak 不可用时自动使用 `public/tle/*.tle` 本地快照，并在 UI 和响应头标明来源。
- **WebGL 降级** — 浏览器硬件加速或 WebGL 不可用时显示明确状态，不让用户面对空白页。
- **选中锁定** — 跟踪状态下不会误切换目标，需点击 `×` 或按 `Esc` 退出跟踪。
- **相机恢复** — 取消跟踪后自动回到聚焦前视角，恢复自动旋转。

## 快捷键

| 按键 | 功能 |
|---|---|
| `/` | 聚焦搜索框 |
| `Space` | 暂停/继续模拟时间 |
| `R` | 重置到当前时间 |
| `1` | 切换到 1× |
| `2` | 切换到 10× |
| `3` | 切换到 60× |
| `Esc` | 取消卫星跟踪 |

快捷键在输入框、文本框和可编辑区域内会被自动屏蔽，不干扰文字输入。

## 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | React 19 + Next.js 16 App Router |
| 构建 | vinext + Vite |
| 三维渲染 | Three.js |
| 轨道传播 | satellite.js / SGP4 |
| 并行计算 | Web Worker |
| 地图数据 | world-atlas / Natural Earth |
| 样式 | Tailwind CSS 4 + 自定义 CSS |
| 字体 | Space Grotesk + IBM Plex Mono |
| 部署 | OpenAI Sites / Cloudflare Workers |
| 预留 | Drizzle ORM + SQLite |

## 环境要求

- Node.js >= 22.13.0
- npm

## 快速启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 代码检查
npm run lint

# 生产构建 + 测试
npm test
```

开发服务器启动后会在终端输出本地访问地址。

## 项目结构

```text
.
├── app/
│   ├── api/tle/route.ts          # CelesTrak 代理 API + 本地快照回退
│   ├── components/GlobeScene.tsx # 禁用 SSR 的场景包装
│   ├── components/GlobeSceneImpl.tsx
│   │                               # Three.js 场景、地球着色器、轨道线、数据获取
│   ├── workers/orbit.worker.ts   # TLE 解析、SGP4 传播、遥测计算
│   ├── globals.css               # 全局视觉样式
│   ├── layout.tsx                # 根布局与字体
│   └── page.tsx                  # 主界面、搜索、遥测、时间控制、快捷键
├── public/
│   ├── tle/                      # 打包 TLE 快照
│   ├── earth-night-lights-2016.jpg
│   └── ne_110m_land.json
├── tests/rendered-html.test.mjs  # 构建与渲染验证
├── worker/index.ts               # Cloudflare Worker 入口
├── brand-spec.md                 # 视觉规范
├── vite.config.ts
├── next.config.ts
└── package.json
```

## 数据流

```text
CelesTrak
  │
  ▼
/api/tle?group=<stations|starlink|gps-ops>
  │
  ├─ 成功：返回 live TLE
  │        x-orbital-source: celestrak-live
  │
  └─ 失败：返回 public/tle/*.tle 打包快照
           x-orbital-source: bundled-snapshot

TLE 文本
  ▼
Web Worker: orbit.worker.ts
  ▼
SatRec / SGP4 传播
  ▼
每帧卫星位置 + 选中目标轨道预测
  ▼
GlobeSceneImpl / Three.js 渲染
```

关键边界：

- TLE 位置是**轨道预测值**，不是卫星直接下行遥测。
- 预测精度取决于 TLE 根数的时效性和目标轨道特性。
- 所有 SGP4 计算在 Web Worker 中执行，避免阻塞主线程。
- `x-orbital-source` 和 `x-orbital-fetched-at` 用于明确数据来源和获取时间。
- 本地快照需要人工更新：从 CelesTrak 下载对应 group 的 TLE 文本后替换 `public/tle/*.tle`。

## 卫星元数据说明

| 字段 | 来源/计算方式 |
|---|---|
| 名称 | TLE 第 0 行 |
| NORAD ID | TLE 第 1 行第 3-7 字符 |
| 发射年份 | TLE 国际标识符两位年份，按 1957 边界转换为四位年份 |
| TLE 历元 | TLE epoch 字段转换为时间戳 |
| 归属国家/地区 | 基于分组和名称关键词的静态分类 |
| 运营方 | 基于分组和名称关键词的静态分类 |
| 轨道周期 | TLE 平均运动：`1440 / meanMotion` |

归属和运营方不是卫星实时广播字段；未知项会显示为「未标注」，不做无依据猜测。

## 交互说明

| 操作 | 效果 |
|---|---|
| 拖动地球 | 旋转视角 |
| 滚轮 | 缩放视野 |
| 点击卫星 | 聚焦目标、显示遥测卡片、绘制预测轨道 |
| 点击 `×` / 按 `Esc` | 取消跟踪并恢复相机 |
| 分组开关 | 显示或隐藏指定卫星组 |
| 搜索结果点击 | 未跟踪时选择目标；跟踪状态下会被忽略 |

## 地球渲染说明

- **白天面**：简化散射着色，突出地球轮廓和空间感。
- **夜晚面**：NASA Black Marble 2016 全球夜间灯光合成图。
- **昼夜分界**：根据太阳方向在 shader 中混合日夜材质。
- **城市灯光阈值**：过滤低亮度噪声，只保留明显夜光。
- **国界/海岸线**：Natural Earth 110m 数据。

夜间灯光纹理是 2016 年历史合成影像，不代表实时城市灯光。来源：[NASA Earth Observatory - Earth at Night](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/)。

## 部署

### OpenAI Sites

仓库已配置 OpenAI Sites：

- Project ID: `appgprj_6a5b044b09848191a01efa48a29663d0`
- 当前线上地址：[https://orbital-live-earth.izhaankismet9932.chatgpt.site](https://orbital-live-earth.izhaankismet9932.chatgpt.site)
- 当前体验不依赖 D1 或 R2 绑定。

### Cloudflare Workers 独立部署

本项目不是 GitHub Pages 纯静态站，推荐用 Cloudflare Workers 部署，因为运行时需要处理 `/api/tle` 动态接口，并托管 vinext 生成的 Worker + 静态资源。

首次部署：

```bash
# 1. 登录 Cloudflare，浏览器会打开授权页
npx wrangler login

# 2. 确认当前登录账号
npx wrangler whoami

# 3. 本地质量检查
npm run lint
npm test

# 4. 可选：只构建并验证部署包，不真正发布
npm run deploy:cloudflare:dry-run

# 5. 发布到 Cloudflare Workers
npm run deploy:cloudflare
```

后续修改代码后的部署流程：

```bash
# 修改代码后
npm run lint
npm test
npm run deploy:cloudflare
```

部署成功后，Wrangler 会在终端输出 `https://<worker-name>.<subdomain>.workers.dev` 形式的公开访问地址。

如果首次部署时看到 `You need to register a workers.dev subdomain before publishing to workers.dev`，说明当前 Cloudflare 账号还没有设置 Workers 子域名。处理方式：

1. 打开 Wrangler 输出的 onboarding 链接，或进入 Cloudflare Dashboard → Workers & Pages；
2. 注册一个 `workers.dev` 子域名，例如 `<your-name>.workers.dev`；
3. 回到项目目录重新执行 `npm run deploy:cloudflare`。

也可以跳过 `workers.dev`，直接在 Cloudflare Worker 的 Settings → Domains & Routes 中绑定自己的域名。

当前构建会生成 `dist/server/wrangler.json`，其中包含 Worker 入口 `dist/server/index.js` 以及静态资源目录 `dist/client`。不要手写上传 `dist/client` 到 GitHub Pages；那不是完整产物。

如果要绑定自定义域名，请在 Cloudflare Dashboard 中进入对应 Worker：

1. Workers & Pages → 选择 `orbital-live` Worker；
2. Settings → Domains & Routes；
3. 添加你的域名或 route；
4. 重新执行 `npm run deploy:cloudflare`。

Cloudflare 凭据、账号 ID、路由配置不写入仓库。

## 视觉规范

详细规范见 [`brand-spec.md`](./brand-spec.md)。核心方向：

- **颜色**：深空黑 `#02080c`、主数据青 `#70e8f0`、文字白 `#eaf9fa`、GPS 琥珀 `#ffd36a`、空间站珊瑚 `#ff7f66`。
- **布局**：细线、低透明玻璃面板、克制辉光、明确数据层级。
- **交互**：地球始终是核心，UI 浮于其上但不抢占视野。

## English Summary

ORBITAL/LIVE is a WebGL-based 3D satellite tracker. It fetches current TLE data from CelesTrak, propagates satellite positions in a browser Web Worker with satellite.js / SGP4, and renders live positions and predicted orbit paths on a Three.js Earth.

The app supports Starlink, operational GPS satellites, and space stations. It includes search, group filters, target lock, telemetry cards, time simulation, live/snapshot data source labeling, and WebGL fallback messaging.

## License

No license file is currently included. Add a `LICENSE` file before distributing this repository as open source.

