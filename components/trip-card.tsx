import Link from "next/link";

import { BookmarkButton } from "@/components/bookmark-button";
import type { TripCardModel, TripCardVariant } from "@/lib/trip-card";

export function TripCard({
  model,
  variant,
  origin,
  week,
  stayBucket,
  selected = false,
}: {
  model: TripCardModel;
  variant: TripCardVariant;
  origin: string;
  week: string;
  stayBucket: string;
  selected?: boolean;
}) {
  const className = `trip-card trip-card--${variant}${selected ? " is-selected" : ""}`;

  const body = (
    <>
      {variant !== "compact" && <span className="trip-card__region">{model.regionLabel}</span>}
      <h3 className="trip-card__city">{model.city}</h3>
      {variant === "grid" && <p className="trip-card__country">{model.country}</p>}
      <p className="trip-card__dates">{model.dateLine}</p>
      {model.badges.length > 0 && (
        <ul className="trip-card__badges">
          {model.badges.map((badge) => (
            <li key={badge.id} className={`trip-badge trip-badge--${badge.tone}`}>
              {badge.label}
            </li>
          ))}
        </ul>
      )}
      <strong className="trip-card__price">{model.priceLabel}</strong>
      <p className="trip-card__definition">
        {model.definition}
        {model.originHint ? ` · ${model.originHint}` : ""}
      </p>
      {variant === "grid" && model.reasons.length > 0 && (
        <ul className="trip-card__reasons">
          {model.reasons.map((reason) => (
            <li key={reason} className="deal-reason-chip">
              {reason}
            </li>
          ))}
        </ul>
      )}
      <span className="trip-card__cta">날짜 보기 →</span>
    </>
  );

  return (
    <article id={`deal-${model.destinationCode}`} className={className}>
      {model.priceAvailable ? (
        <Link href={model.href} className="trip-card__hit" aria-label={model.ariaLabel}>
          {body}
        </Link>
      ) : (
        <div className="trip-card__hit trip-card__hit--disabled">
          {body}
        </div>
      )}
      <div className="trip-card__bookmark">
        <BookmarkButton
          deal={model.bookmarkDeal}
          origin={origin}
          week={week}
          stayBucket={stayBucket}
        />
      </div>
    </article>
  );
}
