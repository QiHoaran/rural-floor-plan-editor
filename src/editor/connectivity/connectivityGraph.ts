import type {
  BuildingDocument,
  BuildingRelation,
} from '../domain/buildingTypes.ts';

export type ConnectivityChannel = 'all' | 'people' | 'air' | 'light';
export type ConnectivityNodeId = string;

export interface ConnectivityEdge {
  to: ConnectivityNodeId;
  wall_element_id: string;
  relation: BuildingRelation;
}

export type ConnectivityGraph = Map<ConnectivityNodeId, ConnectivityEdge[]>;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeMatches(
  relation: BuildingRelation,
  channel: ConnectivityChannel,
): boolean {
  return channel === 'all' || relation.channels[channel];
}

function isDocument(
  input: BuildingDocument | readonly BuildingRelation[],
): input is BuildingDocument {
  return !Array.isArray(input);
}

function cloneRelation(relation: BuildingRelation): BuildingRelation {
  return {
    ...relation,
    to:
      relation.to.kind === 'outside'
        ? { kind: 'outside' }
        : { kind: 'face', face_id: relation.to.face_id },
    channels: { ...relation.channels },
  };
}

export function buildConnectivityGraph(
  input: BuildingDocument | readonly BuildingRelation[],
  channel: ConnectivityChannel = 'all',
): ConnectivityGraph {
  const document = isDocument(input) ? input : undefined;
  const sourceRelations: readonly BuildingRelation[] = isDocument(input)
    ? input.relations
    : input;
  const faceIds = new Set(document ? Object.keys(document.faces) : []);
  const relations = document
    ? sourceRelations.filter(
        (relation) =>
          relation.from_face_id !== 'outside' &&
          faceIds.has(relation.from_face_id) &&
          (relation.to.kind === 'outside' ||
            (relation.to.face_id !== 'outside' &&
              faceIds.has(relation.to.face_id))),
      )
    : sourceRelations;
  const nodeIds = new Set<string>(['outside']);
  if (document) {
    Object.keys(document.faces).forEach((id) => nodeIds.add(id));
  }
  for (const relation of relations) {
    nodeIds.add(relation.from_face_id);
    nodeIds.add(relation.to.kind === 'outside' ? 'outside' : relation.to.face_id);
  }

  const graph: ConnectivityGraph = new Map(
    [...nodeIds].sort(compareStrings).map((id) => [id, []]),
  );
  for (const relation of relations) {
    if (!edgeMatches(relation, channel)) continue;
    const from = relation.from_face_id;
    const to = relation.to.kind === 'outside' ? 'outside' : relation.to.face_id;
    graph.get(from)?.push({
      to,
      wall_element_id: relation.wall_element_id,
      relation: cloneRelation(relation),
    });
    graph.get(to)?.push({
      to: from,
      wall_element_id: relation.wall_element_id,
      relation: cloneRelation(relation),
    });
  }
  for (const edges of graph.values()) {
    edges.sort(
      (left, right) =>
        compareStrings(left.to, right.to) ||
        compareStrings(left.wall_element_id, right.wall_element_id),
    );
  }
  return graph;
}

export function reachableFromOutside(graph: ConnectivityGraph): Set<string> {
  const reachable = new Set<string>(['outside']);
  const queue = ['outside'];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    for (const edge of graph.get(node) ?? []) {
      if (reachable.has(edge.to)) continue;
      reachable.add(edge.to);
      queue.push(edge.to);
    }
  }
  return reachable;
}
