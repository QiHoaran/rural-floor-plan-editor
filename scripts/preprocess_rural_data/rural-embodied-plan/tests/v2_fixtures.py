def raw_rectangle():
    return {
        "schema_version": "2.1",
        "building_id": "test",
        "coordinate_system": {"storage_unit": "mm"},
        "vertices": {
            k: {"x_mm": x, "y_mm": y}
            for k, x, y in [("a", 100, 200), ("b", 4100, 200), ("c", 4100, 3200), ("d", 100, 3200)]
        },
        "walls": {
            str(i): {
                "start_vertex_id": a,
                "end_vertex_id": b,
                "wall_type": "exterior",
                "thickness_mm": 200,
                "height_mm": 2800,
                "material_type": "brick",
            }
            for i, (a, b) in enumerate([("a", "b"), ("b", "c"), ("c", "d"), ("d", "a")])
        },
        "faces": {
            "room": {
                "boundary_vertex_ids": ["a", "b", "c", "d"],
                "area_mm2": 12000000,
                "function_code": None,
                "display_name": "ignored",
            }
        },
        "wall_elements": {
            "door": {
                "element_type": "exterior_door",
                "host_wall_id": "0",
                "offset_from_start_mm": 1000,
                "width_mm": 901,
                "height_mm": 2100,
                "sill_height_mm": 0,
                "status": "valid",
            }
        },
        "relations": [
            {
                "relation_type": "opening",
                "wall_element_id": "door",
                "from_face_id": "room",
                "to": {"kind": "outside"},
                "channels": {"people": True, "air": True, "light": True},
            }
        ],
    }
