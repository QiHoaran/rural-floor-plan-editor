import { describe, expect, it } from 'vitest';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type { BuildingRelation } from '../../src/editor/domain/buildingTypes.ts';
import {
  buildConnectivityGraph,
  reachableFromOutside,
} from '../../src/editor/connectivity/connectivityGraph.ts';

const relations: BuildingRelation[] = [
  {
    relation_type: 'opening',
    wall_element_id: 'window_1',
    from_face_id: 'a',
    to: { kind: 'outside' },
    channels: { people: false, air: true, light: true },
  },
  {
    relation_type: 'opening',
    wall_element_id: 'window_2',
    from_face_id: 'a',
    to: { kind: 'outside' },
    channels: { people: false, air: true, light: true },
  },
  {
    relation_type: 'connection',
    wall_element_id: 'door',
    from_face_id: 'a',
    to: { kind: 'face', face_id: 'b' },
    channels: { people: true, air: true, light: false },
  },
];

describe('buildConnectivityGraph', () => {
  it('builds undirected adjacency and preserves parallel edges', () => {
    const graph = buildConnectivityGraph(relations, 'all');

    expect(graph.get('outside')?.map((edge) => edge.wall_element_id)).toEqual([
      'window_1',
      'window_2',
    ]);
    expect(graph.get('a')?.map((edge) => edge.to)).toEqual([
      'b',
      'outside',
      'outside',
    ]);
    expect(graph.get('b')?.map((edge) => edge.to)).toEqual(['a']);
  });

  it('filters by channel and keeps every document face plus outside as nodes', () => {
    const document = createEmptyBuilding('house', 'reference.png');
    document.faces = {
      a: {
        boundary_vertex_ids: [],
        area_mm2: 0,
        function_code: null,
        display_name: '',
        color: '',
        local_name: '',
      },
      isolated: {
        boundary_vertex_ids: [],
        area_mm2: 0,
        function_code: null,
        display_name: '',
        color: '',
        local_name: '',
      },
    };
    document.relations = relations;

    const people = buildConnectivityGraph(document, 'people');
    const light = buildConnectivityGraph(document, 'light');

    expect([...people.keys()]).toEqual(['a', 'isolated', 'outside']);
    expect(people.get('outside')).toEqual([]);
    expect(light.get('a')?.map((edge) => edge.wall_element_id)).toEqual([
      'window_1',
      'window_2',
    ]);
  });

  it('skips document relations whose face endpoints are not current faces', () => {
    const document = createEmptyBuilding('house', 'reference.png');
    document.faces.room = {
      boundary_vertex_ids: [],
      area_mm2: 0,
      function_code: null,
      display_name: '',
      color: '',
      local_name: '',
    };
    document.relations = [
      {
        relation_type: 'connection',
        wall_element_id: 'room_to_ghost',
        from_face_id: 'room',
        to: { kind: 'face', face_id: 'ghost' },
        channels: { people: true, air: true, light: false },
      },
      {
        relation_type: 'opening',
        wall_element_id: 'ghost_to_outside',
        from_face_id: 'ghost',
        to: { kind: 'outside' },
        channels: { people: true, air: true, light: true },
      },
    ];

    const graph = buildConnectivityGraph(document, 'people');

    expect([...graph.keys()]).toEqual(['outside', 'room']);
    expect(graph.get('room')).toEqual([]);
    expect([...reachableFromOutside(graph)]).toEqual(['outside']);
  });

  it('clones relation payloads independently for each directed edge', () => {
    const source = structuredClone(relations);
    const graph = buildConnectivityGraph(source, 'all');
    const forward = graph
      .get('a')
      ?.find((edge) => edge.wall_element_id === 'door');
    const reverse = graph
      .get('b')
      ?.find((edge) => edge.wall_element_id === 'door');
    if (!forward || !reverse) throw new Error('fixture edge missing');

    forward.relation.channels.people = false;
    if (forward.relation.to.kind === 'face') {
      forward.relation.to.face_id = 'changed';
    }

    expect(source[2].channels.people).toBe(true);
    expect(source[2].to).toEqual({ kind: 'face', face_id: 'b' });
    expect(reverse.relation.channels.people).toBe(true);
    expect(reverse.relation.to).toEqual({ kind: 'face', face_id: 'b' });
  });
});

describe('reachableFromOutside', () => {
  it('returns outside and all nodes reachable through a deterministic BFS', () => {
    const peopleRelations: BuildingRelation[] = [
      {
        ...relations[2],
        wall_element_id: 'inside_2',
        from_face_id: 'b',
        to: { kind: 'face', face_id: 'c' },
      },
      {
        ...relations[2],
        wall_element_id: 'outside_door',
        from_face_id: 'a',
        to: { kind: 'outside' },
      },
      relations[2],
    ];

    expect([...reachableFromOutside(buildConnectivityGraph(peopleRelations, 'people'))]).toEqual([
      'outside',
      'a',
      'b',
      'c',
    ]);
  });
});
