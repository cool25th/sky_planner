import Link from "next/link";

export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <main className="policy-page">
      <section className="policy-hero">
        <p className="section-kicker">Terms of Service</p>
        <h1>이용약관 (Non-commercial Limited Beta)</h1>
        <p>
          본 서비스(Sky Planner Atlas)는 비상업적 제한 공개 베타 버전으로 제공되며, 항공 특가 탐색 경험 및 기술 검증을 목적으로 합니다.
        </p>
      </section>

      <section className="policy-grid">
        <article className="policy-card">
          <h2>1. 서비스의 성격 및 한계</h2>
          <p>
            Sky Planner Atlas는 항공권 직접 판매나 결제 대행을 수행하지 않으며, 일일 1회 배치 캐시 데이터를 기반으로 참고용 가격을 표시합니다.
            모든 실제 예약과 결제는 제휴처 또는 항공사 공식 웹사이트에서 이루어집니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>2. 가격 및 좌석 가능 여부 면책</h2>
          <p>
            표시된 가격은 수집 시점 기준의 세금 포함 왕복 총액(KRW)이며, 항공사의 실시간 운임 변동 및 좌석 상황에 따라 최종 예약 시점의 가격과 다를 수 있습니다.
            최종 결제 금액 및 취소/환불 규정은 최종 예약처의 기준을 따릅니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>3. 비상업적 베타 및 서비스 중단</h2>
          <p>
            본 서비스는 Firebase Spark Plan 및 Vercel Hobby 무료 할당량 내에서 운영되는 비상업적 시험 서비스입니다.
            시스템 점검, 일일 무료 할당량 도달, 또는 데이터 소스 점검 시 사전 고지 없이 서비스가 일시 중단될 수 있습니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>4. 문의 채널</h2>
          <p>
            서비스 오류, 가격 불일치 신고 및 의견은 <Link href="/policies">서비스 정책 페이지</Link>의 공식 문의 채널을 통해 접수하실 수 있습니다.
          </p>
        </article>
      </section>
    </main>
  );
}
