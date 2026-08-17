"use client";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function RouteError({ error, reset }: RouteErrorProps) {
  console.error(error);
  return (
    <section className="service-unavailable-panel">
      <div>
        <p className="section-kicker">일시적 오류</p>
        <h2>화면을 불러오지 못했습니다</h2>
        <p>데이터 조회 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>
      </div>
      <button type="button" className="cta-btn--secondary" onClick={reset}>
        다시 시도
      </button>
    </section>
  );
}
