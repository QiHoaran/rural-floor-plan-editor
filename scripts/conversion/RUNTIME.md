# 编辑器转换运行环境

在本目录执行 `uv sync --all-packages --all-groups --locked`，使用 Python 3.13+。
Windows 解释器为 `.venv/Scripts/python.exe`；Linux/macOS 为 `.venv/bin/python`。
运行 `python adapter.py --check` 检查五种格式依赖；服务器不会自动安装依赖。
锁文件及各 Python 包来自 `参考/preprocess_rural_data`；几何与转换算法保持不变。
正式运行时额外固定 DXF 的 CLASSES 序列顺序，消除 ezdxf 集合迭代导致的跨进程哈希差异，
不改变 DXF 实体、坐标、图层或单位。

服务器使用 `python adapter.py --request <绝对路径/request.json>`：

```json
{
  "source_path": "/absolute/staging/building.json",
  "output_dir": "/absolute/staging/building-output",
  "formats": ["graph", "image", "cad", "embodied", "housegan"],
  "source_sha256": "source-file-sha256",
  "source_revision": 7
}
```

输出目录必须存在，各格式子目录必须不存在。每种格式完成后输出一行 JSON，
字段包括 `format`、`status`（`succeeded`、`quarantined`、`failed`）及可选的
`message`、`output_dir`。逐格式失败不终止后续格式；请求本身无效时进程非零退出。
日志输出到 stderr。适配器只写入暂存目录，最终发布与项目锁由服务器负责。

Embodied 使用完整原始对象及默认 Config；数据不适用会产生独立隔离报告。
TOKEN_GRAMMAR_ERROR、FLOORPLAN_ROUNDTRIP_MISMATCH、NON_DETERMINISTIC_REENCODE
是转换器不变量失败，返回 failed，不能作为正常数据隔离处理。

新增格式时在 adapter.py 的 REGISTRY 注册 Converter（ID、名称、目录、版本、
依赖模块及 execute 函数）。函数负责生成与校验产物，返回有效配置；公共执行器
记录源 revision、哈希、修复与产物哈希。不得修改输入对象或发布半成品。

验证：`python -m pytest tests -q`。全量历史语料测试需要安装相应外部数据；
本地适配器回归使用自包含几何样本，覆盖五格式产物验证、重复转换、
DXF 单位图层、PNG 位深、源不可变、隔离和程序错误。

完整 Embodied 回归：`python -m pytest embodied/tests -q`。
历史样本测试优先读取旧语料目录，亦支持当前编辑器 `data/<building_id>/building.json`；
缺少指定外部样本或 cleaned manifest 时明确跳过对应测试，自包含 embodied 测试仍执行。

HouseGAN 复用共享清洗结果，独立保留官方类别与阳光房 18；生成四字段数据、词表、源映射和 Schema。
前端“数据转换”显示 HouseGAN；单独运行方式及模型接入说明见 `housegan/README.md`。
