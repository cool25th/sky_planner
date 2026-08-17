import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AffiliateDisclosurePage() {
  return (
    <main className="policy-page">
      <section className="policy-hero">
        <p className="section-kicker">Affiliate Disclosure</p>
        <h1>제휴 및 링크 고지 (Non-commercial Limited Beta)</h1>
        <p>
          Sky Planner Atlas의 아웃링크 및 파트너십 정책을 투명하게 공개합니다.
        </p>
      </section>

      <section className="policy-grid">
        <article className="policy-card">
          <h2>1. 비상업적 베타 단계의 수익화 비활성화</h2>
          <p>
            현재 제한 공개 베타 단계에서는 상업적 수익 창출(Affiliate Commission, 광고 수익 등)을 일절 수행하지 않으며, 모든 외부 연결 링크는 순수 기술 검증 및 사용자 탐색 편의를 위해 제공됩니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>2. 정렬 및 가격 투명성 원칙</h2>
          <p>
            특가 정렬 및 추천 결과는 특정 항공사나 제휴처의 이익에 영향을 받지 않으며, 오직 수집된 가격(세금 포함 총액), 직항 여부, 체류 기간 등의 객관적 기준에 의해서만 결정됩니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>3. 파트너십 및 제휴 문의</h2>
          <p>
            공식 데이터 피드 연동 및 파트너십 관련 문의는 <Link href="/policies">서비스 정책 페이지</Link>의 채널로 문의해 주시기 바랍니다.
          </p>
        </article>
      </section>
    </main>
  );
}
