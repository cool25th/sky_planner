import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page-container">
      <div className="status-icon">🧭✨</div>
      <h1 className="status-title">페이지를 찾을 수 없습니다 (404)</h1>
      <p className="status-desc">
        요청하신 페이지가 삭제되었거나, 잘못된 목적지 코드 혹은 주소입니다.
        특가 지도에서 다양한 목적지와 저렴한 날짜를 탐색해 보세요.
      </p>
      <div className="status-actions">
        <Link href="/" className="status-btn-primary">
          홈으로 돌아가기
        </Link>
        <Link href="/map" className="status-btn-secondary">
          특가 지도 탐색하기
        </Link>
      </div>
    </main>
  );
}
