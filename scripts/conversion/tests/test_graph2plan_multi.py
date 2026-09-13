from dataclasses import replace

import numpy as np
from conversion_graph2plan.graph2plan import build_sample, mat_record, validate_record
from conversion_graph2plan.corpus import struct_array
from test_graph2plan import canonical_for, row_of_rooms


def test_rural_profile_serializes_every_projected_entrance():
    sample = build_sample(canonical_for(row_of_rooms(3)))
    second = replace(sample.chosen_entrance, element_id='extra', segment_grid=([248, 90], [248, 110]))
    sample = replace(sample, entrances=[sample.chosen_entrance, second])
    record = mat_record(sample, profile='rural-multi')
    validate_record(record, profile='rural-multi')
    assert np.asarray(record['entrances']).shape == (2, 2, 2)
    assert record['entrances'][0] == sample.door_grid
    assert 'entrances' not in mat_record(sample)
    array = struct_array([record], profile='rural-multi')
    np.testing.assert_array_equal(array['entrances'][0], record['entrances'])
