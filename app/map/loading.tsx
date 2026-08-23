const FILTER_CHIP_IDS = Array.from({ length: 5 }, (_, i) => `chip-${i + 1}`);
const LIST_ITEM_IDS = Array.from({ length: 6 }, (_, i) => `list-item-${i + 1}`);


export default function MapLoading() {
  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Filter Bar Skeleton */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        {FILTER_CHIP_IDS.map((id) => (
          <div
            key={id}
            className="skeleton-shimmer"
            style={{ width: "130px", height: "42px", borderRadius: "10px" }}
          />
        ))}
      </div>

      {/* Split View Skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "20px", minHeight: "calc(100vh - 200px)" }}>
        {/* Left List Skeleton */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {LIST_ITEM_IDS.map((id) => (
            <div
              key={id}
              className="skeleton-shimmer"
              style={{ height: "110px", borderRadius: "14px" }}
            />
          ))}
        </div>

        {/* Right Map Canvas Skeleton */}
        <div
          className="skeleton-shimmer"
          style={{ width: "100%", height: "100%", minHeight: "500px", borderRadius: "16px" }}
        />
      </div>
    </div>
  );
}
