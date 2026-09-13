# Graph2Plan

Convert cleaned rural floor plans into the training data Graph2Plan's own loader reads.
The output is a set of `.mat` splits plus a per-building audit trail, so every value in
the `.mat` can be traced back to `building.json`.

**Loader compatibility:** single-edge buildings require the small `normalize_rEdge`
fix in `Network/model/floorplan.py` described below. An unmodified upstream loader
cannot read those records. The fix changes array shape only, not the graph or model.

From `scripts/conversion`:

```powershell
uv sync --all-packages --all-groups --locked

# One building
uv run conversion-graph2plan convert --input D:\data\house\building.json --output D:\output\house\Graph2Plan

# Whole corpus -> data/data_train.mat, data_valid.mat, data_test.mat
uv run conversion-graph2plan corpus --input-root ..\..\data --output-root D:\output\graph2plan
```

The editor exposes this converter as **Graph2Plan**, which writes `<output>/<building_id>/Graph2Plan/`.
Neither entrypoint edits the source building; both require workflow status `complete` and refuse to overwrite.

## What Graph2Plan actually reads

Taken from the upstream sources, not the README prose: `Network/train.py`,
`Network/model/floorplan.py` (`FloorPlan` and `FloorPlanDataset`) and
`DataPreparation/2.data_train_converted.py`.

| Field | Type | Read by |
| --- | --- | --- |
| `name` | string | `FloorPlanDataset` output key, `train.txt` / `test.txt` |
| `boundary` | `(N, 4)` int `(x, y, dir, isNew)` | `get_input_boundary`, `get_inside_box`, `get_boxes`, `get_layout_image`, `get_inside_coords`, `_get_rot` |
| `rType` | `(R,)` int, `0..12` | `get_rooms`; concatenated onto `gtBoxNew` by `4.data_train_eNum.py` |
| `gtBoxNew` | `(R, 4)` int `(x0, y0, x1, y1)` | `get_attributes`, `get_boxes`, `get_triples`, `get_layout_image` |
| `rEdge` | `(E, 3)` int `(u, v, relation)` | `get_triples` — **only columns 0 and 1 are read** |
| `order` | `(R,)` int, **1-based** | `get_layout_image`, which subtracts one |
| `gtBox` | `(R, 4)` int `(y0, x0, y1, x1)` | nothing in `Network`; defined by the format |
| `rBoundary` | `R × (N, 2)` float | nothing in `Network`; read by `PostProcess/g2p` |

`box` is not stored: `2.data_train_converted.py` builds it as
`np.concatenate([gtBoxNew, rType[:, None]], axis=-1)`, which is why `gtBoxNew` and
`rType` share one dtype.

## Field mapping

| `building.json` | Graph2Plan |
| --- | --- |
| building envelope (union of room polygons) | `boundary` polygon |
| primary exterior door | `boundary[0:2]` — the format's single front door |
| room polygon | `rBoundary` |
| room polygon bounding box | `gtBoxNew` / `gtBox` |
| room function | `rType` |
| room-room adjacency | `rEdge` |
| box overlap precedence | `order` |

**Coordinates.** Rooms, the envelope and the walls are projected with the shared
cleaner's `GridTransform` (256 grid, padding 8, north-up), exactly as the Graph and
HouseGAN converters do, and then mirrored on y into RPLAN's image space where y grows
downwards. The mirror matters: `dir` is documented as `0 right / 1 down / 2 left /
3 up`, which only holds in image space. `FloorPlanDataset` augments the training split
with random rotations and mirrors, so the model is orientation-agnostic, but the
exported `dir` keeps its upstream meaning.

**Room types.** The model's label space is `0..12`: `train.py` builds a 15-way
CrossEntropy weight and zeroes entries 13 and 14, and `3.rNum_train.py` only counts
`range(13)`. The rural corpus carries five labels but Graph2Plan splits bedrooms into
`MasterRoom/ChildRoom/StudyRoom/SecondRoom/GuestRoom` and has no sunroom class:

| rural semantic | `rType` | class |
| --- | --- | --- |
| `living_room` | 0 | LivingRoom |
| `bedroom` | 7 | SecondRoom |
| `kitchen` | 2 | Kitchen |
| `storage` | 11 | Storage |
| `sunroom` | 9 | Balcony |

Every bedroom maps to the generic secondary bedroom rather than over-claiming
MasterRoom's larger area prior, and the sunroom maps to the nearest official glazed
public space. Both stay inside `0..12`, so **no network change is needed**. The corpus
currently contains no sunroom and no unlabelled room; both mappings are defensive. An
unmapped semantic raises `GRAPH2PLAN_UNMAPPED_ROOM` instead of guessing.

**Front doors.** The corpus has 1–3 exterior doors per building (229 of 465 have more
than one). `boundary[0:2]` holds exactly one, chosen deterministically and ranked by:
hosts a living room or kitchen, then longest host wall, then lower x, lower y, lower
element id. Rural main facades are the long exterior walls and main doors lead into the
public room. Every other entrance is still listed in `mapping.json` under
`other_entrances`, and a `MULTIPLE_ENTRANCES` warning is recorded. **The network is not
modified**, so only the chosen door is visible to the model.

The two door endpoints are projected perpendicularly onto the nearest envelope edge
before being inserted, because room polygons are inner faces while doors sit on the
wall centreline — a half wall thickness apart. RPLAN intersects the door mask with the
boundary edge the same way. The inserted points are the only ones marked `isNew = 1`,
exactly as upstream, so `regularize_fp`'s `boundary(~isNew)` rebuilds the original ring.

**`rEdge` reuses the existing room-room graph.** Edges come from the cleaner's
`derived.room_adjacency` (one entry per opening connecting two rooms), collapsed to
`u < v`. Upstream RPLAN instead derives `rEdge` from bbox collision
(`RPLAN-Toolbox`'s `collide2d(th=9)`) and `get_triples` recomputes the relation
predicate from the boxes either way. Both edge sets are computed and the difference is
reported per building in `mapping.json` and corpus-wide in `quality_report.json`, so the
one deliberate deviation from RPLAN is measured rather than assumed. On the current
corpus the door graph is a strict **subset** of the bbox graph: 1423 door edges, 61
extra bbox-only pairs across 54 buildings, and no door-only pairs.

**`order`** is transcribed from `regularize_fp.m` step 2 plus `find_room_order.m`
(overlap precedence, Kahn topological sort with upstream's cycle fallback, then the
unconditional reversal), and is emitted 1-based. `get_layout_image` paints boxes in this
sequence and skips LivingRoom, which leaves it as background.

## Artifacts

| File | Contents |
| --- | --- |
| `data/data_{train,valid,test}.mat` | The only files Graph2Plan needs; pass `<output>/data` as `--dataset_dir` |
| `samples/<building_id>.json` | One `.mat` record as JSON, for review |
| `mapping/<building_id>.json` | Every decision: room ids, `rType`, edges, order, chosen and other entrances, grid, warnings |
| `preview/<building_id>.png` | Two-panel QA render (see below) |
| `preview/_contact_sheet.png` | The first few renders tiled |
| `vocabulary.json`, `record.schema.json` | Mapping table and JSON Schema 2020-12 for one record |
| `manifest.json`, `split.json`, `quality_report.json`, `exclusions.json` | Counts, hashes, split definition, histograms, exclusions |

The QA render's left panel mirrors `vis_fp` — envelope filled with the LivingRoom
colour, bboxes painted in `order`, envelope in the ExteriorWall colour, front door in
the FrontDoor colour — so a rural plan and an RPLAN plan can be compared side by side.
The right panel draws the room graph with door edges solid and the extra upstream
bbox-collision pairs dashed.

## Splits

`conversion_shared.split` assigns each `building_id` to `train`/`valid`/`test` from a
salted SHA-256 bucket, not from a shuffled list position: adding buildings never moves
an existing building, so experiments stay comparable across corpus revisions. The
thresholds are 700/150 of 1000 buckets (~70/15/15). `split.json` records the salt and
thresholds; change them only with a version bump.

Verified on 2026-09-12: 465 buildings → **465 published, 0 excluded**,
**330 train / 70 valid / 65 test**. The previous 455 records and their split assignments
are unchanged; the ten recovered single-edge buildings add eight train and two test records.

## Exclusions

`exclusions.json` lists every building that could not be converted, with a reason code.
The current corpus has **no exclusions**. Previously ten single-edge buildings were
excluded because `sio.loadmat(..., squeeze_me=True)` collapses `(1, 3)` to `(3,)`,
breaking upstream `for u, v, _ in rEdge`.

The local Graph2plan loader now calls `normalize_rEdge(record)` after loading each MAT
record and on the copied record in `FloorPlan.__init__` (also covering direct callers).
It restores precisely `(3,)` to `(1, 3)`, accepts existing nonempty integer `(E, 3)`
arrays unchanged, and rejects malformed or empty arrays with a named `rEdge` error.
Do not flatten arbitrary malformed arrays to make them fit. No edge is duplicated,
reversed, or fabricated. The converter and JSON Schema now require at least **one**
real edge; `GRAPH2PLAN_DEGENERATE_GRAPH` remains the exclusion for **zero** edges.

When using another checkout of Graph2plan, apply this loader fix before training on
these MAT files. The converter's `verify` command uses that checkout directly; it
does not silently patch it. Its independent stored-predicate audit also restores the
single-edge shape before reading column three.

Data limitations are quarantined (`GRAPH2PLAN_DEGENERATE_GRAPH`, `_MULTIFLOOR`,
`_NO_ENTRANCE`, `_UNMAPPED_ROOM`, `_BOUNDARY_COMPONENTS`, `_EMPTY_ROOMS`, `_HOLES`,
`_ROOM_AREA`, `_ROOM_COLLAPSE`, `_DEGENERATE_BOX`). Anything else — a diagonal
envelope edge, a self-edge, a non-permutation `order` — is a converter defect and fails
loudly instead.

Reproducibility: scipy stamps the local wall clock into the MAT v5 header, so the
116-byte text field is rewritten to a fixed banner after saving. A repeated full-corpus
run is byte-identical, which is what `manifest.json`'s artifact hashes rely on.

## Verifying with the patched official loader

```powershell
# needs torch, torchvision, opencv-python and pytorch-ignite; they are NOT workspace
# dependencies, so install them into the workspace venv first:
uv pip install --python .venv/Scripts/python.exe torch torchvision opencv-python-headless pytorch-ignite
uv run conversion-graph2plan verify --graph2plan-root D:\repos\Graph2plan --dataset-dir D:\output\graph2plan\data
```

`verify` puts `<repo>/Network` on `sys.path` and drives the real `FloorPlanDataset`,
`FloorPlan` and `floorplan_collate_fn`, then also compares `rEdge`'s third column with
what the official `get_triples` derives from an unaugmented record. Result on the
current corpus, against local `HanHan55/Graph2plan` commit
`3e53c474c770535c45eadea980a0e032fbcd6e11` plus the single-edge loader fix:

| Split | Records | Loaded | Failures | Predicate mismatches |
| --- | --- | --- | --- | --- |
| train | 330 | 330 | 0 | 0 / 330 |
| valid | 70 | 70 | 0 | 0 / 70 |
| test | 65 | 65 | 0 | 0 / 65 |

Each of the ten recovered buildings was also checked under all four rotations and
both mirror settings (80 cases), then paired with a multi-edge building for a CPU
forward/backward and optimizer step through the default official `Model` with
`generate=True, refine=True`. Box, layout cross-entropy and refined-box losses,
outputs and gradients were finite, and parameters changed. This is a model smoke
test, not a complete training run or a test of the CUDA-only geometry loss suite.

Local reproducible artifacts are under
`D:\Projects\Plan_Gen\graph2plan_single_edge_20260912`: `corpus/`, `baseline.json`,
`loader_report.json`, `recovery_report.json`, and `verify_recovery.py`.

## Running the upstream training

Two upstream/environment blockers remain, **neither of which is a data problem**:

1. `train.py`'s default scheduler passes `ReduceLROnPlateau(verbose=True)`, removed in
   torch 2.x. Use `--scheduler step`, or a torch 1.x environment.
2. `train.py:171` and `model/loss.py` call `.cuda()` unconditionally, so training needs a
   CUDA device. This machine's torch is CPU-only.

The single-edge repair does not change these training-environment requirements.
The CPU smoke test above verifies that the recovered graphs reach every model output
and support backpropagation; see `recovery_report.json` for per-building results.
