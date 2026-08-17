export default function RootLoading() {
  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px" }}>
      {/* Hero Skeleton */}
      <div style={{ padding: "48px 0 32px", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
        <div className="skeleton-shimmer" style={{ width: "320px", height: "36px", borderRadius: "12px" }} />
        <div className="skeleton-shimmer" style={{ width: "480px", height: "20px", borderRadius: "8px" }} />
        <div className="skeleton-shimmer" style={{ width: "100%", maxWidth: "840px", height: "64px", borderRadius: "999px", marginTop: "16px" }} />
      </div>

      {/* Grid Skeleton */}
      <div style={{ marginTop: "40px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "20px" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer"
            style={{ height: "220px", borderRadius: "16px" }}
          />
        ))}
      </div>
    </div>
  );
}
