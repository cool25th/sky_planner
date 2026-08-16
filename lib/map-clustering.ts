export interface ClusterableDeal {
  destination_code: string;
  city: string;
  lat: number;
  lon: number;
  economy_min_total: number | null;
  business_min_total: number | null;
}

export interface DealCluster<T extends ClusterableDeal> {
  deals: T[];
  representative: T;
  min_fare: number | null;
}

export function dealMinFare(deal: ClusterableDeal): number | null {
  const values = [deal.economy_min_total, deal.business_min_total].filter(
    (value): value is number => typeof value === "number",
  );
  return values.length ? Math.min(...values) : null;
}

// REQ-MAP-004: 화면 좌표 기반 그리드 클러스터링. 줌 아웃 시 겹치는 목적지를
// 하나의 가격 뱃지로 묶고, 줌 인 시 자연스럽게 분리된다.
export function clusterDeals<T extends ClusterableDeal>(
  deals: T[],
  project: (deal: T) => { x: number; y: number },
  thresholdPx = 56,
): DealCluster<T>[] {
  const clusters: Array<{ points: Array<{ x: number; y: number }>; deals: T[] }> = [];
  for (const deal of deals) {
    const point = project(deal);
    const target = clusters.find((cluster) =>
      cluster.points.some((known) => Math.hypot(known.x - point.x, known.y - point.y) < thresholdPx),
    );
    if (target) {
      target.points.push(point);
      target.deals.push(deal);
    } else {
      clusters.push({ points: [point], deals: [deal] });
    }
  }
  return clusters.map(({ deals: clusterDeals_ }) => {
    const withFares = clusterDeals_.filter((deal) => dealMinFare(deal) !== null);
    const pool = withFares.length ? withFares : clusterDeals_;
    const representative = pool.reduce((best, deal) =>
      (dealMinFare(deal) ?? Number.MAX_SAFE_INTEGER) < (dealMinFare(best) ?? Number.MAX_SAFE_INTEGER) ? deal : best,
    );
    return { deals: clusterDeals_, representative, min_fare: dealMinFare(representative) };
  });
}
