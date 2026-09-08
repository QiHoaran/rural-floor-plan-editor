"""Keep official IDs, including both door IDs, stable across all projects."""

ROOM_CLASS = {
    "living_room": 1, "kitchen": 2, "bedroom": 3, "bathroom": 4,
    "balcony": 5, "entrance": 6, "dining room": 7, "study room": 8,
    "storage": 10, "front door": 15, "unknown": 16, "interior_door": 17,
    "sunroom": 18,
}
COLORS = {
    1: '#EE4D4D', 2: '#C67C7B', 3: '#FFD274', 4: '#BEBEBE', 5: '#BFE3E8',
    6: '#7BA779', 7: '#E87A90', 8: '#FF8C69', 10: '#1F849B', 15: '#727171',
    16: '#785A67', 17: '#D3A2C7', 18: '#F2C14E',
}
NAMES = {'卧室': 'bedroom', '客厅': 'living_room', '厨房': 'kitchen', '杂物间': 'storage', '阳光房': 'sunroom'}


def room_class(code: object, name: str) -> int:
    # Preserve the editor's built-in Chinese labels even for historical codes.
    key = NAMES.get(name.strip(), str(code or '').strip())
    key = {'dining_room': 'dining room', 'study_room': 'study room'}.get(key, key)
    value = ROOM_CLASS.get(key, 16)
    return value if value not in {15, 17} else 16


def vocabulary() -> dict:
    return {
        'schema_version': 'housegan-rural-vocabulary/1.0.0',
        'room_class': dict(ROOM_CLASS), 'id_color': {str(k): v for k, v in COLORS.items()},
        'one_hot_num_classes': 19, 'node_feature_size': 18,
        'door_ids': [15, 17], 'extension_ids': [18],
    }
