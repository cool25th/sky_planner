export default function OffersLoading() {
  return (
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "24px 20px" }}>
      {/* Header Skeleton */}
      <div
        className="skeleton-shimmer"
        style={{ width: "100%", height: "100px", borderRadius: "16px", marginBottom: "20px" }}
      />

      {/* Filter / Sort Chips Skeleton */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer"
            style={{ width: "90px", height: "36px", borderRadius: "999px" }}
          />
        ))}
      </div>

      {/* Offers Cards Skeleton */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer"
            style={{ height: "140px", borderRadius: "16px" }}
          />
        ))}
      </div>
    </div>
  );
}
