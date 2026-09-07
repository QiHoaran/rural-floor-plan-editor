# RuralEmbodiedPlan

RuralEmbodiedPlan 是一个独立的 Python 研究项目，把乡村住宅编辑器的 `building.json` 转换为确定性的机器人探索轨迹，再编码为可用于自回归 next-token 研究的 Action-Observation Token 序列。当前版本只验证数据闭环与空间图可逆性，不包含 Transformer、神经网络或训练代码。

## 为什么用机器人探索序列表示建筑

静态平面图适合几何编辑，但 next-token 模型需要有顺序、上下文和明确引用的序列。房间级机器人把“进入房间—观察墙面—选择门—移动—穿门—回溯”变成稳定事件流，同时保留房间语义、墙面方向、开口和邻接。这使建筑拓扑可以被顺序建模，又能通过解码恢复为可验证的空间图。

## 数据处理流程

```text
cleaned/canonical/*.json
    -> navigation_scene.json
    -> trajectory.json
    -> tokens.json
    -> reconstructed_spatial_graph.json
```

新的单栋实验链路 `canonical_dfs_time_v1` 并行保留旧格式：

```text
building.json
    -> navigation_scene.json
    -> timed_trajectory.json
    -> behavior_tokens.json
    -> validation_report.json
```

该版本使用 DFS 决定房间顺序、clearance-aware minimum-execution-time planner 决定
房内路径，并从独立的 `robot_config.json` 推导毫秒时长。完整约束见
[canonical-dfs-time-v1.md](docs/canonical-dfs-time-v1.md)。

- `navigation_scene.json`：整数毫米房间多边形、房间边界墙段、门窗中心/锚点、方向和邻接。
- `trajectory.json`：每一步的 before/action/observation/after 状态快照。
- `tokens.json`：可读 Token、稳定 token ID 和词表版本。
- `reconstructed_spatial_graph.json`：只从 Token 恢复的房间节点、门边、入口、深度、环路和开口方向。

字段来源、几何推导和降级策略见 [building-json-analysis.md](docs/building-json-analysis.md)，状态机见 [trajectory-specification.md](docs/trajectory-specification.md)，编码格式见 [token-specification.md](docs/token-specification.md)。

## 当前机器人状态机

机器人从按 NORTH、EAST、SOUTH、WEST 与门中心坐标稳定排序的主外门开始。进入房间后依次激活进入墙、LOOK_FRONT、LOOK_LEFT、LOOK_RIGHT；室内门从进入墙沿边界顺时针排序，使用 DFS 探索并反向执行父房间路径。矩形房间优先直线/L 路径，正交凹房间回退到正交可见图。已访问房间产生引用和环路闭合，不建立重复节点。

样例含两个互不连通的室内分量。0.1.0 在主入口分量完成后，只通过次入口覆盖尚未访问分量；室外门间移动抽象为选择动作并写入 warning。只有室外窗、没有可通行门路的房间以 `visual_only` 模式写入房间图，窗保持不可通行且不会产生 `CROSS_DOOR`。所有房间处理后状态回到主外门外侧并 STOP。

## 安装

要求 Python 3.13 和 [uv](https://docs.astral.sh/uv/)。

```powershell
cd scripts\preprocess_rural_data
uv sync --all-packages --all-groups
```

依赖由 `pyproject.toml` 和 `uv.lock` 锁定。项目采用 src layout；不需要也不会修改原建筑编辑器。

## CLI

```powershell
uv run --package rural-embodied-plan rural-embodied-plan inspect `
  "D:\Projects\rural-floor-plan-editor\data\rural_001_house_0015\building.json"

uv run --package rural-embodied-plan rural-embodied-plan build-scene `
  "D:\Projects\rural-floor-plan-editor\data\rural_001_house_0015\building.json" `
  --output "outputs\rural_001_house_0015\navigation_scene.json"

uv run --package rural-embodied-plan rural-embodied-plan generate-trajectory `
  "outputs\rural_001_house_0015\navigation_scene.json" `
  --output "outputs\rural_001_house_0015\trajectory.json"

uv run --package rural-embodied-plan rural-embodied-plan encode `
  "outputs\rural_001_house_0015\trajectory.json" `
  --output "outputs\rural_001_house_0015\tokens.json"

uv run --package rural-embodied-plan rural-embodied-plan reconstruct `
  "outputs\rural_001_house_0015\tokens.json" `
  --output "outputs\rural_001_house_0015\reconstructed_spatial_graph.json"

uv run --package rural-embodied-plan rural-embodied-plan pipeline `
  "D:\Projects\rural-floor-plan-editor\data\rural_001_house_0015\building.json" `
  --output-dir "outputs\rural_001_house_0015"

uv run --package rural-embodied-plan rural-embodied-plan pipeline-timed `
  "D:\Projects\rural-floor-plan-editor\data\rural_001_house_0015\building.json" `
  --output-dir "outputs\rural_001_house_0015_timed" `
  --robot-config "rural-embodied-plan\examples\robot_config.json"

uv run --package rural-embodied-plan rural-embodied-plan build-corpus `
  --input-root "data\rural_data\cleaned" `
  --output-root "data\rural_data\model_ready\embodied"

uv run --package rural-embodied-plan rural-embodied-plan build-timed-corpus `
  --input-root "data\rural_data\cleaned" `
  --output-root "data\rural_data\model_ready\embodied" `
  --robot-config "rural-embodied-plan\examples\robot_config.json" `
  --replace

uv run --package rural-embodied-plan rural-embodied-plan visualize `
  "rural-embodied-plan\outputs\rural_001_house_0015"
```

可用 `--config examples/sample_config.yaml` 替换旧流程配置。Timed 流程的机器人半径、
安全间距、锚点、运动速度、固定动作耗时和时间 bins 独立放在
`examples/robot_config.json`，通过 `--robot-config` 选择。

`build-corpus` 是正式语料入口：它验证 cleaned manifest 与每份 canonical 的 SHA-256，全部建筑和 Schema 验证通过后才原子发布。失败时不保留部分输出，只写同级 `embodied.failure.json`。单栋 raw `pipeline` 仅用于调试。

`visualize` 会验证该目录中的 `navigation_scene.json`、`trajectory.json` 和
`tokens.json`，随后在 `http://127.0.0.1:8765` 播放机器人探索。房间、墙、门窗随观察
逐步显现，当前事件对应的 Action-Observation Token 会同步高亮。使用 `--no-open`
可禁止自动打开浏览器，使用 `--host` 和 `--port` 可更改监听地址。

## 输出文件

完整 pipeline 额外生成：

- `building_summary.json`：输入版本、单位和实体计数；
- `validation_report.json`：场景、探索与 round-trip 错误，warnings 和统计；
- 三个主格式均有 `schemas/` 下的 JSON Schema。

`pipeline-timed` 只处理一栋建筑并生成六个文件：`building_summary.json`、
`navigation_scene.json`、`robot_config.json`、`timed_trajectory.json`、
`behavior_tokens.json` 和 `validation_report.json`。它不会触发全量语料转换。

`build-timed-corpus` 会在同级 staging 目录完成所有建筑后原子发布。单栋失败不会
回退到旧策略或进行室外 teleport，而是仅写入 `quarantine/<building_id>/`
`quarantine_report.json`。语料根目录同时生成带制品 SHA-256 的
`corpus_manifest.json`、聚合统计 `corpus_summary.json` 和约束审计
`dataset_audit.json`；该命令只生成数据，不启动训练。

输出不写生成时间或随机值，因此核心 JSON 可进行字节级复现比较。

## 测试与质量检查

```powershell
uv run --package rural-embodied-plan ruff format --check rural-embodied-plan
uv run --package rural-embodied-plan ruff check rural-embodied-plan
uv run --package rural-embodied-plan mypy `
  --config-file rural-embodied-plan/pyproject.toml rural-embodied-plan/src
uv run --package rural-embodied-plan pytest rural-embodied-plan/tests
```

测试覆盖源格式加载、场景完整性、入口/墙面/门排序、凹多边形路径、DFS 完整性、Token round-trip、重复运行确定性和平移不变性。

## Reversible v2（单户生成 + 审计，不训练）

`canonical_global_scan_dfs_time_v2` 已提供独立于旧流程的 `pipeline-v2` 和 `decode-v2`。
完整协议与验证结果见 [v2 实现说明](docs/reversible-v2.md)。

在本包目录使用仓库虚拟环境：

```powershell
& ../.venv/Scripts/python.exe -m rural_embodied_plan.cli pipeline-v2 `
  D:/Plan_Gen/data/rural_data/JSON/rural_001_house_0015/draft/building.autosave.json `
  --output-dir outputs/my-v2-sample

& ../.venv/Scripts/python.exe -m rural_embodied_plan.cli decode-v2 `
  outputs/my-v2-sample/behavior_tokens.json `
  --robot-config outputs/my-v2-sample/robot_config.json `
  --output outputs/my-independent-floorplan.json
```

可通过 `--robot-config` 传入 v2 配置；默认配置会写入输出。路径已存在时拒绝覆盖。
`decode-v2` 不接收建筑 source、scene、trajectory 或 ID map。仅双向 exact round-trip、
物理重放和 schema 验证通过才发布；异常只产生 quarantine_report，CLI 返回2。
尚未提供 v2 全量 corpus 发布命令，原 model_ready 不变。

## Legacy / v1 已知限制

- 当前只支持单层、正交墙和简单房间多边形；遇到非法或歧义几何会明确失败。
- 路径验证采用机器人中心线被房间闭多边形覆盖，不模拟机器人半径和墙体厚度膨胀。
- 门扇开启弧、院落语义及室外连续路径未建模。
- 多入口不连通分量使用明确的室外重定位抽象。
- 连续几何经过 bin 离散后不能从 Token 精确恢复；精确值保留在 trajectory。

`canonical_dfs_time_v1` 的限制更严格：不连通室内分量会被拒绝；其他外门不用于
绕建筑导航；环路仅作闭合确认并立即原路返回；目前不包含动态障碍和门扇开启弧。

## 下一阶段计划

- 统计建筑探索规律
- 建立 Markov next-token 基线
- 建立小型 Decoder-only Transformer
- 加入 Grammar Mask
- 从 Token 生成新的空间图
