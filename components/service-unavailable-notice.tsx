import Link from "next/link";

import { serviceUnavailableNotice } from "@/lib/service-unavailable";

interface ServiceUnavailableNoticeProps {
  diagnostics?: unknown;
  className?: string;
  actionHref?: string;
  actionLabel?: string;
}

export function ServiceUnavailableNotice({
  diagnostics,
  className = "",
  actionHref = "/service-readiness",
  actionLabel = "운영 상태 보기",
}: ServiceUnavailableNoticeProps) {
  const notice = serviceUnavailableNotice(diagnostics);
  const classes = ["service-unavailable-panel", className].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <div>
        <p className="section-kicker">{notice.kicker}</p>
        <h2>{notice.title}</h2>
        <p>{notice.body}</p>
        <div className="service-unavailable-meta">
          <span>{notice.statusLabel}</span>
          <span>{notice.detailLabel}</span>
        </div>
      </div>
      <Link href={actionHref} className="chip service-secondary-link">
        {actionLabel}
      </Link>
    </section>
  );
}
