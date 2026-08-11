export type WallFraction = '1/4' | '1/2' | '3/4';

export interface WallElementPlacement {
  centerOffsetMm: number;
  offsetFromStartMm: number;
  fraction?: WallFraction;
}

const FRACTIONS: ReadonlyArray<{ value: number; label: WallFraction }> = [
  { value: 0.25, label: '1/4' },
  { value: 0.5, label: '1/2' },
  { value: 0.75, label: '3/4' },
];

/** 将构件中心吸附到常用墙体分点，并夹紧到零端距合法范围。 */
export function resolveWallElementPlacement(
  wallLengthMm: number,
  elementWidthMm: number,
  requestedCenterMm: number,
  snapToleranceMm: number,
): WallElementPlacement {
  const minimumCenter = elementWidthMm / 2;
  const maximumCenter = wallLengthMm - elementWidthMm / 2;
  let center = requestedCenterMm;
  let fraction: WallFraction | undefined;

  if (elementWidthMm <= wallLengthMm) {
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of FRACTIONS) {
      const candidateCenter = wallLengthMm * candidate.value;
      if (candidateCenter < minimumCenter || candidateCenter > maximumCenter) {
        continue;
      }
      const distance = Math.abs(requestedCenterMm - candidateCenter);
      if (distance <= snapToleranceMm && distance < nearestDistance) {
        center = candidateCenter;
        fraction = candidate.label;
        nearestDistance = distance;
      }
    }
    center = Math.max(minimumCenter, Math.min(maximumCenter, center));
  }

  const offsetFromStartMm = Math.round(center - elementWidthMm / 2);
  return {
    centerOffsetMm: offsetFromStartMm + elementWidthMm / 2,
    offsetFromStartMm,
    ...(fraction ? { fraction } : {}),
  };
}
