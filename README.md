# 乡村住宅矢量编辑器 v0.2

> 本项目是面向乡村住宅矢量化、空间语义标注和科研数据生产的专用平台，不是完整 CAD 软件。

基于点—墙—面拓扑数据模型的农村户型平面图编辑器。根据参考草图绘制精确墙体结构，自动推导房间面、院落和联通关系，支持数据质量审核、批量房间标注和多种科研数据格式导出。

## 环境要求

- **Node.js** ≥ 22
- **npm** ≥ 10

## 快速开始

```bash
# 安装依赖（仅首次）
npm install

# 启动开发服务器（Express + Vite HMR，默认端口 4173）
npm run dev

# 浏览器打开
# http://localhost:4173
```

开发模式使用 `tsx watch` 热重载服务端，Vite 在中间件模式代理前端资源。

## 所有命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动全栈开发服务器（Express + Vite） |
| `npm run dev:web` | 仅启动 Vite 前端开发服务器 |
| `npm run server` | 仅启动 Express 后端 |
| `npm run build` | TypeScript 检查 + Vite 生产构建 |
| `npm run build:server` | 仅检查服务端 TypeScript |
| `npm run preview` | 预览生产构建（Vite preview） |
| `npm test` | 运行全部单元测试（Vitest） |
| `npm run test:watch` | 监视模式运行测试 |
| `npm run test:e2e` | 运行 E2E 测试（Playwright） |
| `npm run test:e2e:ui` | E2E 测试 UI 模式 |
| `npm run lint` | Oxlint 代码检查 |

## 生产部署

```bash
# 1. 构建
npm run build

# 2. 启动生产服务器
NODE_ENV=production npm run server

# 生产模式下 Express 直接托管 dist/ 静态资源
# 默认端口 4173，可通过 PORT 环境变量覆盖
```

## 项目结构

```
rural-floor-plan-editor/
├── server/                      # Express 后端
│   ├── index.ts                 # 入口
│   ├── app.ts                   # Express 应用工厂
│   ├── config.ts                # 配置（端口、数据目录）
│   ├── projectService.ts        # 项目 CRUD、导出、软删除
│   ├── routes/
│   │   └── projects.ts          # REST API 路由
│   ├── atomicWrite.ts           # 原子写入工具
│   ├── pathSafety.ts            # 路径校验
│   └── errors.ts                # 业务错误类
├── src/
│   ├── editor/
│   │   ├── canvas/              # SVG 画布
│   │   │   ├── SvgCanvas.tsx    # 主画布（事件、交互）
│   │   │   ├── Viewport.ts      # 视口变换
│   │   │   └── layers/          # 图层
│   │   │       ├── WallLayer.tsx
│   │   │       ├── VertexLayer.tsx
│   │   │       ├── FaceLayer.tsx
│   │   │       ├── WallElementLayer.tsx
│   │   │       ├── ReferenceImageLayer.tsx
│   │   │       └── OverlayLayer.tsx
│   │   ├── commands/            # 命令（事务语义）
│   │   │   ├── wallCommand.ts   # 画墙命令
│   │   │   ├── pointMoveCommand.ts  # 顶点移动/删除
│   │   │   └── wallElementCommand.ts # 墙上构件放置
│   │   ├── topology/            # 拓扑引擎
│   │   │   ├── normalizeGraph.ts    # 图归一化、墙插入
│   │   │   ├── segmentIntersection.ts # 线段相交计算
│   │   │   ├── faceTraversal.ts  # 半边遍历推导面
│   │   │   ├── faceMatching.ts   # 面 ID 稳定匹配
│   │   │   └── outsideRegions.ts # 院落识别
│   │   ├── cad/                 # CAD 功能
│   │   │   └── snapEngine.ts    # 吸附引擎
│   │   ├── domain/              # 领域模型
│   │   │   ├── buildingTypes.ts     # 核心类型（BuildingDocument v2.1.0）
│   │   │   ├── buildingDocument.ts  # 文档工厂
│   │   │   ├── buildingValidation.ts # 结构化校验系统
│   │   │   ├── buildingStatistics.ts # 统计计算
│   │   │   ├── buildingGeoJson.ts    # GeoJSON 导出
│   │   │   ├── spatialGraph.ts       # 空间图导出
│   │   │   ├── exportUtils.ts        # 统一导出工具
│   │   │   ├── unitConversion.ts     # 单位转换（集中式）
│   │   │   ├── cadInput.ts           # 米制输入解析
│   │   │   ├── cadWall.ts            # 墙几何计算
│   │   │   ├── faceFunctions.ts      # 房间功能标注
│   │   │   ├── wallEditing.ts        # 墙尺寸编辑
│   │   │   ├── recomputeGeometry.ts  # 统一几何重算管线
│   │   │   ├── schema/               # JSON Schema + AJV 校验
│   │   │   │   ├── buildingDocument.schema.json
│   │   │   │   └── validateBuildingDocument.ts
│   │   │   └── migrations/           # 数据迁移模块
│   │   │       └── index.ts
│   │   ├── connectivity/        # 联通关系
│   │   ├── panels/              # 面板
│   │   │   ├── EditablePropertyPanel.tsx  # 属性面板
│   │   │   ├── VertexPropertyPanel.tsx
│   │   │   ├── FaceFunctionPanel.tsx
│   │   │   ├── ConnectivityPanel.tsx
│   │   │   ├── DataQualityPanel.tsx     # v0.2 数据质量面板
│   │   │   ├── RoomLabelPanel.tsx       # v0.2 房间标注面板
│   │   │   └── StatusBar.tsx            # v0.2 状态栏
│   │   ├── toolbar/             # 工具栏
│   │   ├── store/               # Zustand 状态管理
│   │   └── hooks/               # React Hooks
│   ├── projects/                # 项目首页
│   │   ├── ProjectHome.tsx      # 项目列表 + 回收站（v0.2 丰富卡片）
│   │   └── NewProjectDialog.tsx # 新建对话框
│   └── api/                     # 前端 API 客户端
│       └── projectApi.ts
├── tests/
│   ├── unit/                    # 单元测试
│   ├── topology/                # 拓扑测试
│   ├── connectivity/            # 联通关系测试
│   ├── components/              # 组件测试
│   ├── server/                  # 服务端测试
│   └── e2e/                     # E2E 测试
├── data/                        # 项目数据（运行时生成）
└── docs/                        # 设计文档
```

## 技术架构

### 数据模型

```
点 (Vertex) ──→ 墙 (Wall) ──→ 面 (Face)
                    │
                    ├── 墙上构件 (WallElement)：门、窗、洞口
                    │
                    └── 联通关系 (Relation)：人员/空气/采光
```

- **唯一领域模型**: `BuildingDocument` (Schema v2.1.0)
- **内部存储统一使用整数毫米 (mm)**
- 界面输入使用米 (m)，通过集中式单位转换函数处理
- 默认墙厚 **240 mm**（创建项目时可自定义）
- 容差统一为 **1 mm**

### Schema 版本

当前版本：**2.1.0**

| 版本 | 单位 | 说明 |
|------|------|------|
| 0.2.0 | cm | 旧 PlanDocument 格式 |
| 2.0.0 | mm | 初版 BuildingDocument |
| 2.1.0 | mm | 统一元数据、场地、工作流、统计、结构化校验 |

### 命令模式

所有写操作通过命令对象执行，支持 undo/redo：

```
命令执行 → 结构克隆 → 拓扑归一化 → 几何重算 → 事务提交
```

事务失败时自动回滚，原始文档不可变。

### 几何重算管线

```
validateWallElementGeometry
  → deriveFaces (半边遍历)
    → applyOutsideRegions (院落识别)
      → applyDerivedRelations (联通推导)
```

墙插入和顶点移动操作均通过此统一管线。

### revision 规则

- 自动保存携带客户端 `revision`，服务端乐观锁校验
- `revision` 冲突返回 409，前端停止自动保存
- 完成/重开项目时 `revision` 递增，写入 revision 历史

### 项目工作流

```
draft → pending_review → reviewed → complete
  ↑         ↓              ↓           ↓
  └─────────┴──────────────┴───────────┘ (reopen)
```

## v0.2 功能

| 类别 | 功能 | 状态 |
|------|------|------|
| 数据模型 | 统一 BuildingDocument v2.1.0 | ✓ |
| 数据模型 | 统一毫米单位 | ✓ |
| 数据模型 | 结构化校验问题模型 | ✓ |
| 数据模型 | JSON Schema + AJV 运行时校验 | ✓ |
| 数据模型 | 旧版数据迁移（PlanDocument → BuildingDocument） | ✓ |
| 项目管理 | 项目列表丰富卡片（统计、进度、问题数） | ✓ |
| 项目管理 | 工作流状态（draft/pending_review/reviewed/complete） | ✓ |
| 项目管理 | revision 乐观锁 | ✓ |
| 项目管理 | revision 历史查看与恢复 | ✓ |
| 数据质量 | 分类校验（几何/拓扑/语义/通行/通风/采光/参考） | ✓ |
| 数据质量 | 数据质量面板（筛选、定位、高亮） | ✓ |
| 数据质量 | 完成前强制检查 | ✓ |
| 批量标注 | 乡村住宅房间功能字典（16 种） | ✓ |
| 批量标注 | 房间标注刷工具 | ✓ |
| 批量标注 | 多选批量标注 | ✓ |
| 批量标注 | 快捷键标注（0-9） | ✓ |
| 批量标注 | Tab/Shift+Tab 跳转未标注房间 | ✓ |
| 统计显示 | 建筑统计（几何/语义/门窗完成度） | ✓ |
| 统计显示 | 编辑器状态栏（工具/比例/北向/统计/保存） | ✓ |
| 导出 | Building JSON 导出 | ✓ |
| 导出 | 空间图导出（节点+边+关系通道） | ✓ |
| 导出 | GeoJSON 导出（local_cartesian_mm） | ✓ |
| 导出 | ZIP 建筑包导出 | ✓ |
| 参考标定 | 北向设置字段 | ✓ |
| 参考标定 | 比例标定数据结构 | ✓ |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/projects` | 列出活跃项目（含统计信息） |
| `GET` | `/api/projects/trash` | 列出回收站项目 |
| `POST` | `/api/projects` | 创建新项目 |
| `GET` | `/api/projects/:id` | 打开项目（含自动迁移） |
| `PUT` | `/api/projects/:id/autosave` | 自动保存（带 revision 锁） |
| `POST` | `/api/projects/:id/submit-review` | 提交审核 |
| `POST` | `/api/projects/:id/review` | 审核通过（可选 reviewer） |
| `POST` | `/api/projects/:id/complete` | 完成项目（强制校验） |
| `POST` | `/api/projects/:id/reopen` | 重新打开编辑 |
| `GET` | `/api/projects/:id/revisions` | 列出 revision 历史 |
| `GET` | `/api/projects/:id/revisions/:rev` | 获取指定 revision |
| `POST` | `/api/projects/:id/revisions/:rev/restore` | 恢复指定 revision |
| `DELETE` | `/api/projects/:id` | 移入回收站 |
| `POST` | `/api/projects/:id/restore` | 从回收站恢复 |
| `GET` | `/api/projects/:id/export` | 下载建筑包 ZIP |
| `GET` | `/api/projects/:id/files/*` | 获取项目文件 |

## 导出格式

### Building JSON

`{building_id}_building_v{revision}.json` — 完整 BuildingDocument v2.1.0

### 空间图

`{building_id}_spatial_graph_v{revision}.json` — 节点（房间/院落）+ 边（门/窗/通道）+ 人员/空气/采光通道

### GeoJSON

`{building_id}_building_v{revision}.geojson` — FeatureCollection，坐标系标注为 `local_cartesian_mm`，不伪造 EPSG

### ZIP 建筑包

`{building_id}.zip` — 包含 building.json + floorplan.png + reference image + metadata.json

## 快捷键

| 快捷键 | 操作 |
|--------|------|
| `Ctrl+Z` | 撤销 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 |
| `Space` + 拖拽 | 平移画布 |
| `1`–`9`, `0` | 房间标注刷：选择功能 |
| `Tab` | 下一个未标注房间 |
| `Shift+Tab` | 上一个未标注房间 |
| `Esc` | 退出标注刷 / 取消绘制 |
| `Delete` | 删除选中实体 |

## 数据迁移

打开旧版项目时，服务端自动执行迁移：

- 识别 Schema 版本（0.2.0 / 2.0.0）
- 厘米 → 毫米转换
- openings → wall_elements 转换
- spaces → faces 转换
- 补充缺失字段（metadata, site, workflow）
- 返回迁移警告

迁移模块位于 `src/editor/domain/migrations/index.ts`，可独立测试。

## 测试命令

```bash
npm test              # 全部单元测试 (380 tests)
npm run test:watch    # 监视模式
npm run test:e2e      # E2E 测试
npm run lint          # 代码检查
```

## 已知限制

- 不支持多层建筑（当前仅单层 `floor_1`）
- 不支持 BIM 三维建模
- 不支持 AI 自动识别
- 不支持多人协同
- GeoJSON 使用局部坐标，非 WGS84

## 后续路线

- v0.3: 湿热模拟参数（材料热工属性、气候数据接入）
- v0.4: 生成式平面布局实验接口
- v0.5: EnergyPlus/WUFI 模拟器接入
- v1.0: 完整科研数据管线

## 签证

本项目是面向乡村住宅矢量化、空间语义标注和科研数据生产的专用平台，不是完整 CAD 软件。
