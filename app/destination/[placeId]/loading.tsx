const INFO_CELL_IDS = Array.from({ length: 4 }, (_, i) => `info-cell-${i + 1}`);
const RECOMMENDATION_IDS = Array.from({ length: 3 }, (_, i) => `recommendation-${i + 1}`);


export default function DestinationLoading() {
  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "24px 20px" }}>
      {/* Header Banner Skeleton */}
      <div
        className="skeleton-shimmer"
        style={{ width: "100%", height: "140px", borderRadius: "16px", marginBottom: "24px" }}
      />

      {/* Travel Info Grid Skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {INFO_CELL_IDS.map((id) => (
          <div
            key={id}
            className="skeleton-shimmer"
            style={{ height: "60px", borderRadius: "12px" }}
          />
        ))}
      </div>

      {/* Top Recommendations Skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" }}>
        {RECOMMENDATION_IDS.map((id) => (
          <div
            key={id}
            className="skeleton-shimmer"
            style={{ height: "180px", borderRadius: "16px" }}
          />
        ))}
      </div>

      {/* Matrix Table Skeleton */}
      <div
        className="skeleton-shimmer"
        style={{ width: "100%", height: "420px", borderRadius: "16px" }}
      />
    </div>
  );
}
