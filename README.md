# 乡村住宅 CAD 矢量编辑器

基于点—墙—面拓扑数据模型的农村户型平面图编辑器。根据参考草图绘制精确墙体结构，自动推导房间面、院落和联通关系，支持导出独立建筑包。

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
│   │   │   ├── buildingTypes.ts     # 类型定义
│   │   │   ├── buildingDocument.ts  # 文档工厂
│   │   │   ├── cadInput.ts          # 米制输入解析
│   │   │   ├── cadWall.ts           # 墙几何计算
│   │   │   ├── wallEditing.ts       # 墙尺寸编辑
│   │   │   └── recomputeGeometry.ts # 统一几何重算管线
│   │   ├── connectivity/        # 联通关系
│   │   ├── panels/              # 属性面板
│   │   │   ├── EditablePropertyPanel.tsx
│   │   │   ├── VertexPropertyPanel.tsx
│   │   │   ├── FaceFunctionPanel.tsx
│   │   │   └── ConnectivityPanel.tsx
│   │   ├── toolbar/             # 工具栏
│   │   ├── store/               # Zustand 状态管理
│   │   └── hooks/               # React Hooks
│   ├── projects/                # 项目首页
│   │   ├── ProjectHome.tsx      # 项目列表 + 回收站
│   │   └── NewProjectDialog.tsx # 新建对话框（含墙厚设置）
│   └── api/                     # 前端 API 客户端
│       └── projectApi.ts
├── tests/
│   ├── unit/                    # 单元测试
│   ├── topology/                # 拓扑测试
│   ├── connectivity/            # 联通关系测试
│   ├── components/              # 组件测试
│   ├── server/                  # 服务端测试
│   └── e2e/                     # E2E 测试
│       └── smoke.spec.ts
├── data/                        # 项目数据（运行时生成）
│   ├── <building_id>/           # 各项目目录
│   └── .trash/                  # 回收站
└── docs/                        # 设计文档
```

## 架构概要

### 数据模型

```
点 (Vertex) ──→ 墙 (Wall) ──→ 面 (Face)
                    │
                    ├── 墙上构件 (WallElement)：门、窗、洞口
                    │
                    └── 联通关系 (Relation)：人员/空气/采光
```

- 内部存储统一使用**整数毫米**，界面输入使用**米**
- 默认墙厚 **240 mm**（创建项目时可自定义）
- 容差统一为 **1 mm**

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

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/projects` | 列出活跃项目 |
| `GET` | `/api/projects/trash` | 列出回收站项目 |
| `POST` | `/api/projects` | 创建新项目 |
| `GET` | `/api/projects/:id` | 打开项目 |
| `PUT` | `/api/projects/:id/autosave` | 自动保存 |
| `DELETE` | `/api/projects/:id` | 移入回收站 |
| `POST` | `/api/projects/:id/restore` | 从回收站恢复 |
| `GET` | `/api/projects/:id/export` | 下载建筑包 ZIP |
| `GET` | `/api/projects/:id/files/*` | 获取项目文件 |

## 功能清单

- [x] 点—墙—面拓扑数据模型
- [x] 交点自动拆分与拓扑归一化
- [x] 几何吸附（顶点 > 交点 > 墙上投影 > 网格）
- [x] 半边遍历自动推导面
- [x] 功能区与院落
- [x] 开口与联通关系推导（人员/空气/采光）
- [x] 墙上构件（门、窗、洞口）
- [x] CAD 式连续画墙（方向约束、数值输入）
- [x] 顶点拖动与坐标编辑
- [x] 项目创建时设置默认墙厚
- [x] 项目软删除与回收站恢复
- [x] 建筑包 ZIP 导出（JSON + 参考图 + 元数据）
- [x] 撤销/重做
- [x] 自动保存
- [x] 参考草图校准
