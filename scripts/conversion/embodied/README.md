# Embodied

Embodied 是一个独立的 Python 转换包，把乡村住宅编辑器的 `building.json` 转换为确定性的机器人探索序列，再编码为可用于自回归 next-token 研究的 Action-Observation Token 序列。编码采用精确可逆的 canonical 协议（`canonical_global_scan_dfs_time_v2`），可从 Token 双向精确还原平面图。当前版本只验证数据闭环与空间图可逆性，不包含 Transformer、神经网络或训练代码。

## 为什么用机器人探索序列表示建筑

静态平面图适合几何编辑，但 next-token 模型需要有顺序、上下文和明确引用的序列。房间级机器人把“进入房间—观察墙面—选择门—移动—穿门—回溯”变成稳定事件流，同时保留房间语义、墙面方向、开口和邻接。这使建筑拓扑可以被顺序建模，又能通过独立解码恢复为可验证的空间图。

## 数据处理流程

```text
building.json
    -> canonical_floorplan.json          规范化平面图（整数毫米、归一化平移）
    -> behavior_tokens.json             精确可逆 Token（policy: canonical_global_scan_dfs_time_v2）
    -> reconstructed_floorplan.json      仅从 Token 独立解码恢复的平面图
```

单个成功输出目录包含 10 个制品：`canonical_floorplan.json`、`reconstructed_floorplan.json`、
`robot_config.json`、`behavior_tokens.json`、`vocabulary.json`、`timed_trajectory.json`、
`validation_report.json`、`navigation_scene.json`、`building_summary.json` 与
`artifact_schemas.json`。协议与验证细节见 [实现说明](docs/reversible.md)。

## 安装

要求 Python 3.13 和 [uv](https://docs.astral.sh/uv/)。

```powershell
cd scripts\conversion
uv sync --all-packages --all-groups
```

依赖由 `pyproject.toml` 和 `uv.lock` 锁定。项目采用 src layout；不需要也不会修改原建筑编辑器。

## CLI

```powershell
# 单户生成（路径已存在时拒绝覆盖）
& ../.venv/Scripts/python.exe -m embodied.cli pipeline `
  D:/Plan_Gen/data/rural_data/JSON/rural_001_house_0015/draft/building.autosave.json `
  --output-dir outputs/my-sample

# 仅从 Token 与 robot_config 独立解码，双向精确还原
& ../.venv/Scripts/python.exe -m embodied.cli decode `
  outputs/my-sample/behavior_tokens.json `
  --robot-config outputs/my-sample/robot_config.json `
  --output outputs/my-independent-floorplan.json

# 从 cleaned corpus 生成并审计完整语料
uv run --package embodied embodied build-corpus `
  --input-root "data\rural_data\cleaned" `
  --output-root "data\rural_data\model_ready\embodied"

# 只读回读审计，不修改已发布语料
uv run --package embodied embodied audit-corpus `
  --input-root "data\rural_data\cleaned" `
  --output-root "data\rural_data\model_ready\embodied"
```

`pipeline` 只处理一栋建筑，输出前会运行独立的 token-only 解码、物理重放、精确
源-目标比较、重编码与全部制品 Schema 验证；异常只产生 `quarantine_report.json`，
CLI 返回 2。`build-corpus` 是正式语料入口：它验证 cleaned manifest 与每份 canonical
的 SHA-256，全部建筑和 Schema 验证通过后才原子发布，失败时不保留部分输出。

## 输出文件

- `canonical_floorplan.json`：整数毫米房间多边形、墙面、开口与邻接，绝对平移已归一化。
- `behavior_tokens.json`：可读 Token、稳定 token ID、策略/词表版本与 robot_config 摘要。
- `reconstructed_floorplan.json`：仅从 Token 恢复的平面图，与 canonical 逐字节一致。
- `validation_report.json`：状态、组件计数、schema 校验计数与 round-trip 结果。

输出不写生成时间或随机值，因此核心 JSON 可进行字节级复现比较。

## 测试与质量检查

```powershell
uv run --package embodied ruff format --check embodied
uv run --package embodied ruff check embodied
uv run --package embodied mypy `
  --config-file embodied/pyproject.toml embodied/src
uv run --package embodied pytest embodied/tests
```

测试覆盖精确编码/解码、floorplan 规范化、物理重放、corpus 发布与审计、重复运行确定性、
平移不变性与隔离（quarantine）语义。

## 已知限制

- 当前只支持单层、正交墙和简单房间多边形；遇到非法或歧义几何会明确失败。
- 带洞/障碍的房间（`holes`、`interior_rings`、`obstacles`）被隔离，需要未来的 codec。
- 门扇开启弧、院落语义及室外连续路径未建模。
- 不连通室内分量通过明确的 session RESET 抽象处理，不模拟室外连续转移。

## 下一阶段计划

- 统计建筑探索规律
- 建立 Markov next-token 基线
- 建立小型 Decoder-only Transformer
- 加入 Grammar Mask
- 从 Token 生成新的空间图
