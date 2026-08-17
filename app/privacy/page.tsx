import Link from "next/link";

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <section className="policy-hero">
        <p className="section-kicker">Privacy Policy</p>
        <h1>개인정보처리방침 (Non-commercial Limited Beta)</h1>
        <p>
          Sky Planner Atlas는 사용자의 개인정보를 소중히 여기며, 최소한의 정보만을 처리합니다.
        </p>
      </section>

      <section className="policy-grid">
        <article className="policy-card">
          <h2>1. 수집하는 개인정보 항목</h2>
          <p>
            본 서비스는 별도의 회원가입이나 로그인을 요구하지 않으며, 여권 정보, 결제 카드 정보 등 민감한 개인정보를 일절 수집하거나 저장하지 않습니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>2. 자동 수집되는 정보</h2>
          <p>
            서비스 안정성 분석 및 비정상 트래픽 탐지를 위해 접속 IP, 브라우저 종류, 접속 시각, 검색 조건 등의 비식별 로그가 서버 환경에 임시 기록될 수 있습니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>3. 개인정보의 제3자 제공 및 외부 위탁</h2>
          <p>
            사용자가 예약 링크를 클릭하여 외부 제휴사나 항공사로 이동하는 경우, 해당 웹사이트의 개인정보처리방침이 적용됩니다.
          </p>
        </article>

        <article className="policy-card">
          <h2>4. 개인정보 보호책임 및 문의</h2>
          <p>
            개인정보 처리 관련 문의 사항은 <Link href="/policies">서비스 정책 페이지</Link>의 공식 문의 채널을 통해 접수하실 수 있습니다.
          </p>
        </article>
      </section>
    </main>
  );
}
