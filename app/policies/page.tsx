import { resolveSupportContact } from "@/lib/service-contact";

export const dynamic = "force-dynamic";

function supportPolicyCopy() {
  const contact = resolveSupportContact();
  if (!contact.ok || !contact.email) {
    return "가격 불일치, 깨진 링크, 잘못된 운임 표시는 문의 채널 설정 후 접수합니다. 운영자는 source 단위 비활성화와 직전 성공 캐시 유지로 장애 영향을 줄입니다.";
  }
  return `가격 불일치, 깨진 링크, 잘못된 운임 표시는 ${contact.email} 로 접수합니다. 운영자는 source 단위 비활성화와 직전 성공 캐시 유지로 장애 영향을 줄입니다.`;
}

function policySections() {
  return [
    {
      title: "가격과 예약 가능 여부",
      body: "검색 결과는 수집 시점의 세금 포함 총액을 기준으로 표시합니다. 최종 결제 금액, 좌석 가능 여부, 수하물, 환불 조건은 예약처 화면에서 다시 확인해야 합니다.",
    },
    {
      title: "제휴 링크",
      body: "일부 예약 링크는 제휴 또는 광고성 링크일 수 있습니다. 링크 이동이나 예약 여부가 정렬 결과에 영향을 주지 않도록 가격, 직항 여부, 품질 상태를 우선 기준으로 사용합니다.",
    },
    {
      title: "데이터 갱신",
      body: "서비스는 배치 수집과 source health 상태를 기준으로 오래된 결과를 제한합니다. source 장애, 가격 변동, sold-out 감지는 운영 상태에 반영됩니다.",
    },
    {
      title: "개인정보",
      body: "현재 검색 흐름은 로그인 없이 동작하며 결제 정보와 여권 정보를 받지 않습니다. 문의 메일을 보내는 경우 답변을 위해 메일 주소와 문의 내용을 보관할 수 있습니다.",
    },
    {
      title: "문의와 장애",
      body: supportPolicyCopy(),
    },
  ];
}

export default function PoliciesPage() {
  const sections = policySections();

  return (
    <main className="policy-page">
      <section className="policy-hero">
        <p className="section-kicker">Service Policies</p>
        <h1>서비스 정책</h1>
        <p>
          항공권 가격 비교에서 사용자가 오해하기 쉬운 최종 가격, 제휴 링크, 데이터 갱신, 개인정보, 장애 대응 기준을 공개합니다.
        </p>
      </section>

      <section className="policy-grid">
        {sections.map((section) => (
          <article key={section.title} className="policy-card">
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
