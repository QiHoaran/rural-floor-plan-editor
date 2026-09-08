# HouseGAN

Convert a completed `building.json` into House-GAN++ JSON with a fixed rural vocabulary.
The editor exposes this converter as **HouseGAN** in its existing data conversion dialog.

From `scripts/conversion`:

```powershell
uv sync --all-packages --all-groups --locked
uv run conversion-housegan --input D:\data\house\building.json --output D:\output\house\HouseGAN
```

The CLI's `--output` is the final artifact directory, which must not already exist.
The frontend uses `<output root>/<building_id>/HouseGAN/` and supports the existing
skip/overwrite, revision checks, task recovery and atomic publication behavior.
Neither entrypoint edits the source building. Both require workflow status `complete`.

## Artifacts

| File | Contents |
| --- | --- |
| `housegan.json` | Only the four official fields: `room_type`, `boxes`, `edges`, `ed_rm` |
| `vocabulary.json` | Fixed IDs, colors, vocabulary version and one-hot dimensions |
| `mapping.json` | Source IDs and labels, original opening types, image transform, ignored entities and warnings |
| `housegan.schema.json` | JSON Schema 2020-12 for the model payload |
| `conversion.json` | Source SHA-256/revision, repairs, converter version and artifact hashes |

Each room and door is a node. Rooms precede doors; each group is sorted by source ID.
`boxes[i]` is `[xmin, ymin, xmax, ymax]` for node `i`.
`edges[j]` is `[x0, y0, x1, y1, owner_type, adjacent_type]`, where adjacent type 0 means no node.
`ed_rm[j]` is `[owner_index]` or `[owner_index, adjacent_index]`, with zero-based indices.
Shared room boundaries occur in **both** owner's loops, split at partial overlaps.
This is necessary because the official mask builder only uses `ed_rm[j][0]`.
Room adjacency means positive-length shared boundary, not merely a shared corner.
Door long sides carry their connected room index, derived from the completed opening relations.

Room outlines use the cleaned polygon, including concave shapes. A door is a rectangle
of its opening width and host-wall thickness. All nodes use the same aspect-preserving
256-square projection, eight-pixel minimum padding, north up and image Y down.
Floating coordinates are preserved to ten decimal places. The extent includes doors,
so exterior door thickness is not clipped. `mapping.json` records the inverse-recoverable
rotation, scale and offset. Coordinates describe cleaned geometry, not unmodified source geometry.

## Vocabulary and model use

Official IDs are retained: living room 1, kitchen 2, bedroom 3, bathroom 4, balcony 5,
entrance 6, dining room 7, study 8, storage 10, front door 15, unknown 16, interior door 17.
The fixed rural extension is **sunroom 18**. Built-in Chinese labels are recognized
for historical source codes; otherwise known official codes are preserved and
unrecognized/custom/unlabelled rooms become unknown 16. Original labels remain in the mapping.
No project-specific class numbers are allocated.

Passages are represented as interior/front door nodes according to their traversable
connections; original types are retained. Exterior passages require an explicit outside
relation because the shared cleaner does not infer outside passage connections.
Windows and outside regions are excluded from the model payload and listed in the mapping.
Empty rooms, holes, overlapping/invalid polygons, ambiguous or non-traversable door
relations, invalid thickness and empty 64-square masks fail explicitly. More than one
nonempty floor is rejected: export each floor separately. The converter uses the shared
cleaner's geometry repair and validation, including its training-grid validity checks.

The upstream code uses a 19-row embedding with row 0 removed, giving 18 node features.
ID 18 fits those dimensions, but the official pretrained weights have **not learned
sunroom semantics**. Add `sunroom: 18` to upstream `ROOM_CLASS` and color 18 to `ID_COLOR`
(from `vocabulary.json`), rebuild reverse mappings, and retrain or fine-tune for this vocabulary.
This repository does not run training or inference.

The official dataset constructor takes a text file with one JSON path per line, including
a newline after the last entry. Generate that list from **only** `HouseGAN/housegan.json`,
excluding sidecar JSON. For example, in PowerShell:

```powershell
$houseganFiles = Get-ChildItem -LiteralPath 'D:\output' -Filter housegan.json -Recurse -File |
    Where-Object { $_.Directory.Name -eq 'HouseGAN' } | Sort-Object FullName
$houseganFiles.FullName | Set-Content -LiteralPath 'D:\output\housegan-files.txt' -Encoding utf8NoBOM
```

Use paths valid on the training machine (regenerate after moving the dataset). Pass the
list to `FloorplanGraphDataset`; `split='test'` loads every listed sample, whereas the
official train/eval splits filter by `target_set` room count. The loader returns masks,
one-hot room/door features and positive/negative adjacency triples.

Format references:
- [Official reader and mask builder](https://github.com/ennauata/houseganpp/blob/main/dataset/floorplan_dataset_maps_functional_high_res.py)
- [Official vocabulary](https://github.com/ennauata/houseganpp/blob/main/misc/utils.py)
- [Official model dimensions](https://github.com/ennauata/houseganpp/blob/main/models/models.py)
- [Officially linked data extractor](https://github.com/sepidsh/Housegan-data-reader)

Run `uv run python -m unittest discover -s tests -p test_housegan.py -v` for CPU-only
geometry, mask, adjacency, vocabulary and CLI checks; no Torch or weights are needed.
