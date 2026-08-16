const currency = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const state = {
  meta: null,
  metaEnvelope: null,
  mapData: null,
  mapEnvelope: null,
  calendarData: null,
  calendarEnvelope: null,
  offersData: null,
  offersEnvelope: null,
  origin: "ICN",
  week: "",
  region: "ALL",
  cabin: "ALL",
  traveler: "adt1",
  stayBucket: "5_7",
  airlines: new Set(),
  selectedDestination: null,
  selectedCell: null,
  matrixCabin: "ALL",
  offerAirline: "ALL",
  offerCabin: "ALL",
  offerStops: "ALL",
};

const els = {
  originSelect: document.getElementById("origin-select"),
  weekSelect: document.getElementById("week-select"),
  regionChips: document.getElementById("region-chips"),
  cabinChips: document.getElementById("cabin-chips"),
  globalBucketChips: document.getElementById("global-bucket-chips"),
  prototypeNote: document.getElementById("prototype-note"),
  metricDestinations: document.getElementById("metric-destinations"),
  metricLowest: document.getElementById("metric-lowest"),
  metricCaptured: document.getElementById("metric-captured"),
  batchStripLast: document.getElementById("batch-strip-last"),
  batchStripSources: document.getElementById("batch-strip-sources"),
  batchStripMode: document.getElementById("batch-strip-mode"),
  selectionSummary: document.getElementById("selection-summary"),
  mapPins: document.getElementById("map-pins"),
  regionList: document.getElementById("region-list"),
  dealCount: document.getElementById("deal-count"),
  airlineChips: document.getElementById("airline-chips"),
  calendarTitle: document.getElementById("calendar-title"),
  calendarSubtitle: document.getElementById("calendar-subtitle"),
  matrixCabinChips: document.getElementById("matrix-cabin-chips"),
  bucketChips: document.getElementById("bucket-chips"),
  matrixTable: document.getElementById("matrix-table"),
  destinationSpotlight: document.getElementById("destination-spotlight"),
  selectedCellCard: document.getElementById("selected-cell-card"),
  offersSubtitle: document.getElementById("offers-subtitle"),
  offerAirlineFilters: document.getElementById("offer-airline-filters"),
  offerCabinFilters: document.getElementById("offer-cabin-filters"),
  offerStopFilters: document.getElementById("offer-stop-filters"),
  offersList: document.getElementById("offers-list"),
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function formatMoney(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return currency.format(value);
}

function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

function formatDateTime(value) {
  return timeFormatter.format(new Date(value));
}

function formatStamp(value) {
  if (!value) {
    return "-";
  }
  return formatDateTime(value);
}

function buildQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "" || value === "ALL") {
      if (key === "cabin" || key === "region" || key === "origin" || key === "week") {
        search.set(key, value);
      }
      return;
    }
    search.set(key, value);
  });
  return search.toString();
}

function bucketLabel(code) {
  return state.meta?.trip_buckets.find((item) => item.code === code)?.label || code;
}

function sourceLabel(flag) {
  const labels = {
    skyscanner_affiliate: "Skyscanner",
    korean_air_official: "대한항공 공식",
    asiana_official: "아시아나 공식",
  };
  return labels[flag] || flag;
}

function updateBatchStrip(envelope) {
  if (!envelope) {
    els.batchStripLast.textContent = "-";
    els.batchStripSources.textContent = "-";
    els.batchStripMode.textContent = "성인 1인 · 일 1회 갱신";
    return;
  }
  els.batchStripLast.textContent = formatStamp(envelope.last_batch_at);
  els.batchStripSources.textContent = envelope.source_flags.map(sourceLabel).join(" · ");
  els.batchStripMode.textContent = `성인 1인 · ${bucketLabel(state.stayBucket)} · 일 1회 갱신`;
}

function renderChips(container, items, selected, onClick, mode = "single") {
  container.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip ${selected.has ? (selected.has(item.code) ? "is-active" : "") : selected === item.code ? "is-active" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", () => onClick(item.code, mode));
    container.appendChild(button);
  });
}

function dealDisplayPrice(deal) {
  const values = [deal.economy_min_total, deal.business_min_total].filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

function pinTop(lat) {
  const raw = ((72 - lat) / 145) * 100;
  return Math.min(88, Math.max(10, raw));
}

function pinLeft(lon) {
  const raw = ((lon + 180) / 360) * 100;
  return Math.min(92, Math.max(8, raw));
}

function priceTone(price, min, max) {
  if (!price || !min || !max || min === max) {
    return "rgba(255,255,255,0.04)";
  }
  const ratio = (price - min) / (max - min);
  const alpha = 0.38 - ratio * 0.22;
  return `rgba(53, 208, 186, ${Math.max(0.12, alpha).toFixed(3)})`;
}

function chooseDestination() {
  if (!state.mapData || !state.mapData.deals.length) {
    state.selectedDestination = null;
    return;
  }
  const exists = state.mapData.deals.find((deal) => deal.destination_code === state.selectedDestination);
  if (!exists) {
    state.selectedDestination = state.mapData.deals[0].destination_code;
  }
}

function chooseCell() {
  if (!state.calendarData || !state.calendarData.cells.length) {
    state.selectedCell = null;
    return;
  }
  const cells = getVisibleCells();
  if (!cells.length) {
    state.selectedCell = null;
    return;
  }
  const exists = cells.find(
    (cell) =>
      state.selectedCell &&
      cell.depart_date === state.selectedCell.depart_date &&
      cell.return_date === state.selectedCell.return_date,
  );
  if (!exists) {
    const sorted = [...cells].sort((a, b) => cellSortValue(a) - cellSortValue(b));
    state.selectedCell = sorted[0];
  }
}

function cellSortValue(cell) {
  const values = [];
  if (cell.economy_min_total !== null) {
    values.push(cell.economy_min_total);
  }
  if (cell.business_min_total !== null) {
    values.push(cell.business_min_total);
  }
  return values.length ? Math.min(...values) : Number.POSITIVE_INFINITY;
}

function getVisibleCells() {
  if (!state.calendarData) {
    return [];
  }
  return state.calendarData.cells.filter((cell) => {
    if (state.matrixCabin === "ECONOMY" && cell.economy_min_total === null) {
      return false;
    }
    if (state.matrixCabin === "BUSINESS" && cell.business_min_total === null) {
      return false;
    }
    return true;
  });
}

function updateHeroMetrics() {
  const deals = state.mapData ? state.mapData.deals : [];
  els.metricDestinations.textContent = deals.length ? `${deals.length}곳` : "-";
  const best = deals.map(dealDisplayPrice).filter(Boolean);
  els.metricLowest.textContent = best.length ? formatMoney(Math.min(...best)) : "-";
  els.metricCaptured.textContent = state.mapEnvelope ? formatStamp(state.mapEnvelope.last_batch_at) : "-";
}

function renderMetaControls() {
  els.originSelect.innerHTML = "";
  state.meta.origins.forEach((origin) => {
    const option = document.createElement("option");
    option.value = origin.code;
    option.textContent = origin.label;
    els.originSelect.appendChild(option);
  });
  els.originSelect.value = state.origin;
  els.originSelect.addEventListener("change", async (event) => {
    state.origin = event.target.value;
    state.selectedDestination = null;
    state.selectedCell = null;
    await refreshMap();
  });

  els.weekSelect.innerHTML = "";
  state.meta.weeks.forEach((week) => {
    const option = document.createElement("option");
    option.value = week.code;
    option.textContent = week.label;
    els.weekSelect.appendChild(option);
  });
  state.week = state.meta.weeks[0].code;
  els.weekSelect.value = state.week;
  els.weekSelect.addEventListener("change", async (event) => {
    state.week = event.target.value;
    state.selectedDestination = null;
    state.selectedCell = null;
    await refreshMap();
  });

  renderChips(
    els.regionChips,
    state.meta.regions,
    state.region,
    async (code) => {
      state.region = code;
      state.selectedDestination = null;
      state.selectedCell = null;
      await refreshMap();
    },
  );

  renderChips(
    els.cabinChips,
    state.meta.cabins,
    state.cabin,
    async (code) => {
      state.cabin = code;
      state.matrixCabin = code === "ALL" ? "ALL" : code;
      state.selectedCell = null;
      await refreshMap();
    },
  );

  renderChips(
    els.globalBucketChips,
    state.meta.trip_buckets.filter((item) => item.code !== "ALL"),
    state.stayBucket,
    async (code) => {
      state.stayBucket = code;
      state.selectedDestination = null;
      state.selectedCell = null;
      await refreshMap();
    },
  );

  els.prototypeNote.textContent = `${state.meta.prototype_note} 현재 활성 소스: ${state.metaEnvelope.source_flags.map(sourceLabel).join(", ")}.`;
  updateBatchStrip(state.metaEnvelope);
}

function renderMapPins() {
  els.mapPins.innerHTML = "";
  if (!state.mapData || !state.mapData.deals.length) {
    els.mapPins.innerHTML = `<div class="empty-state" style="position:absolute; inset:18px;">선택한 조건에 맞는 목적지가 없습니다.</div>`;
    return;
  }

  state.mapData.deals.forEach((deal) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pin ${state.selectedDestination === deal.destination_code ? "is-selected" : ""}`;
    button.style.left = `${pinLeft(deal.lon)}%`;
    button.style.top = `${pinTop(deal.lat)}%`;
    button.innerHTML = `
      <div class="pin-city">
        <span>${deal.city}</span>
        <span>${deal.region_label}</span>
      </div>
      <div class="pin-country">${deal.country}</div>
      <div class="pin-prices">
        <div class="price-line"><span>Eco</span><strong>${formatMoney(deal.economy_min_total)}</strong></div>
        <div class="price-line"><span>Biz</span><strong>${formatMoney(deal.business_min_total)}</strong></div>
      </div>
      <div class="pin-country">배치 ${formatStamp(deal.last_batch_at)}</div>
      <div class="pin-badges">
        ${deal.promotion_tags
          .slice(0, 2)
          .map((badge) => `<span class="badge ${badge === "공식 특가" ? "promo" : "sale"}">${badge}</span>`)
          .join("")}
      </div>
    `;
    button.addEventListener("click", async () => {
      state.selectedDestination = deal.destination_code;
      state.selectedCell = null;
      await refreshCalendar();
      renderMapPins();
      renderRegionList();
    });
    els.mapPins.appendChild(button);
  });
}

function renderRegionList() {
  els.regionList.innerHTML = "";
  if (!state.mapData || !state.mapData.deals.length) {
    els.regionList.innerHTML = `<div class="empty-state">표시할 지역별 특가가 없습니다.</div>`;
    els.dealCount.textContent = "0 routes";
    return;
  }

  const grouped = state.mapData.deals.reduce((acc, deal) => {
    if (!acc[deal.region_label]) {
      acc[deal.region_label] = [];
    }
    acc[deal.region_label].push(deal);
    return acc;
  }, {});

  Object.entries(grouped).forEach(([label, deals]) => {
    const wrapper = document.createElement("section");
    wrapper.className = "region-group";
    const title = document.createElement("h3");
    title.textContent = label;
    wrapper.appendChild(title);

    deals.forEach((deal) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `deal-row ${state.selectedDestination === deal.destination_code ? "is-selected" : ""}`;
      row.innerHTML = `
        <div class="deal-top">
          <div class="deal-title">
            <strong>${deal.city}</strong>
            <span>${deal.country}</span>
          </div>
          <div class="pin-badges">
            ${deal.promotion_tags
              .slice(0, 2)
              .map((badge) => `<span class="badge ${badge === "공식 특가" ? "promo" : "sale"}">${badge}</span>`)
              .join("")}
          </div>
        </div>
        <div class="deal-prices">
          <div class="price-line"><span>Eco</span><strong>${formatMoney(deal.economy_min_total)}</strong></div>
          <div class="price-line"><span>Biz</span><strong>${formatMoney(deal.business_min_total)}</strong></div>
        </div>
        <div class="matrix-meta">마지막 배치 ${formatStamp(deal.last_batch_at)}</div>
      `;
      row.addEventListener("click", async () => {
        state.selectedDestination = deal.destination_code;
        state.selectedCell = null;
        await refreshCalendar();
        renderMapPins();
        renderRegionList();
      });
      wrapper.appendChild(row);
    });

    els.regionList.appendChild(wrapper);
  });

  els.dealCount.textContent = `${state.mapData.deals.length} deals`;
}

function renderAirlineFilterChips() {
  const items = [{ code: "__ALL__", label: "전체 항공사" }, ...state.mapData.available_airlines.map((airline) => ({ code: airline.code, label: airline.name }))];
  els.airlineChips.innerHTML = "";
  items.forEach((item) => {
    const active = item.code === "__ALL__" ? state.airlines.size === 0 : state.airlines.has(item.code);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip ${active ? "is-outline" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", async () => {
      if (item.code === "__ALL__") {
        state.airlines.clear();
      } else if (state.airlines.has(item.code)) {
        state.airlines.delete(item.code);
      } else {
        state.airlines.add(item.code);
      }
      state.selectedDestination = null;
      state.selectedCell = null;
      await refreshMap();
    });
    els.airlineChips.appendChild(button);
  });
}

function renderSelectionSummary() {
  if (!state.mapData) {
    els.selectionSummary.textContent = "-";
    return;
  }
  const activeAirlines = state.airlines.size ? `${state.airlines.size}개 항공사` : "전체 항공사";
  const regionLabel = state.meta.regions.find((item) => item.code === state.region)?.label || "전체";
  els.selectionSummary.textContent = `${state.origin} · ${state.week} · ${bucketLabel(state.stayBucket)} · ${regionLabel} · ${activeAirlines}`;
}

function renderMatrixControls() {
  renderChips(
    els.matrixCabinChips,
    state.meta.cabins,
    state.matrixCabin,
    async (code) => {
      state.matrixCabin = code;
      state.selectedCell = null;
      chooseCell();
      renderMatrix();
      await refreshOffers();
    },
  );

  renderChips(
    els.bucketChips,
    state.meta.trip_buckets.filter((item) => item.code !== "ALL"),
    state.stayBucket,
    async (code) => {
      state.stayBucket = code;
      state.selectedCell = null;
      await refreshMap();
    },
  );
}

function renderSpotlight() {
  if (!state.calendarData || !state.calendarData.destination) {
    els.destinationSpotlight.innerHTML = `<h3>목적지를 선택하세요</h3><p>지도 핀이나 지역 리스트를 누르면 날짜 매트릭스가 열립니다.</p>`;
    return;
  }

  const deal = state.mapData.deals.find((item) => item.destination_code === state.selectedDestination);
  els.destinationSpotlight.innerHTML = `
    <p class="section-kicker">${state.calendarData.destination.region_label}</p>
    <h3>${state.calendarData.destination.city}, ${state.calendarData.destination.country}</h3>
    <p>선택한 주간의 출발일과 귀국일 조합을 모두 펼쳐봅니다. 현재 체류 버킷은 ${bucketLabel(state.stayBucket)}이며, 대표가는 일 1회 배치 기준입니다.</p>
    <div class="spotlight-stat"><span>대표 Eco</span><strong>${formatMoney(deal?.economy_min_total)}</strong></div>
    <div class="spotlight-stat"><span>대표 Biz</span><strong>${formatMoney(deal?.business_min_total)}</strong></div>
    <div class="spotlight-stat"><span>마지막 배치</span><strong>${formatStamp(state.calendarEnvelope?.last_batch_at)}</strong></div>
  `;
}

function renderSelectedCellCard() {
  if (!state.selectedCell) {
    els.selectedCellCard.innerHTML = `<h3>날짜를 선택하세요</h3><p>매트릭스 셀을 누르면 실제 항공편 옵션을 하단에 띄웁니다.</p>`;
    return;
  }

  els.selectedCellCard.innerHTML = `
    <p class="section-kicker">Selected Window</p>
    <h3>${formatDate(state.selectedCell.depart_date)} → ${formatDate(state.selectedCell.return_date)}</h3>
    <p>${state.selectedCell.stay_nights}박 · ${state.selectedCell.trip_bucket}</p>
    <div class="spotlight-stat"><span>Eco 최저가</span><strong>${formatMoney(state.selectedCell.economy_min_total)}</strong></div>
    <div class="spotlight-stat"><span>Biz 최저가</span><strong>${formatMoney(state.selectedCell.business_min_total)}</strong></div>
    <div class="spotlight-stat"><span>대표 항공사</span><strong>${[state.selectedCell.best_airline_by_cabin.ECONOMY, state.selectedCell.best_airline_by_cabin.BUSINESS].filter(Boolean).join(" / ") || "-"}</strong></div>
    <div class="spotlight-stat"><span>배치 상태</span><strong>${formatStamp(state.selectedCell.last_batch_at)}</strong></div>
  `;
}

function renderMatrix() {
  renderMatrixControls();
  renderSpotlight();
  renderSelectedCellCard();

  if (!state.calendarData || !state.calendarData.cells.length) {
    els.calendarTitle.textContent = "날짜 매트릭스";
    els.calendarSubtitle.textContent = "목적지를 선택하면 출발일 x 귀국일 최저가를 보여줍니다.";
    els.matrixTable.innerHTML = "";
    return;
  }

  const visibleCells = getVisibleCells();
  const visiblePrices = visibleCells.flatMap((cell) => {
    const prices = [];
    if (state.matrixCabin !== "BUSINESS" && cell.economy_min_total !== null) {
      prices.push(cell.economy_min_total);
    }
    if (state.matrixCabin !== "ECONOMY" && cell.business_min_total !== null) {
      prices.push(cell.business_min_total);
    }
    return prices;
  });

  const minPrice = visiblePrices.length ? Math.min(...visiblePrices) : null;
  const maxPrice = visiblePrices.length ? Math.max(...visiblePrices) : null;

  els.calendarTitle.textContent = `${state.calendarData.destination.city} 날짜 매트릭스`;
  els.calendarSubtitle.textContent = `${state.origin} 출발 · ${state.week} · ${bucketLabel(state.stayBucket)} · ${visibleCells.length}개 유효 셀`;

  const cellMap = new Map();
  visibleCells.forEach((cell) => {
    cellMap.set(`${cell.depart_date}::${cell.return_date}`, cell);
  });

  const rows = state.calendarData.departure_dates
    .map((departDate) => {
      const cells = state.calendarData.return_dates
        .map((returnDate) => {
          const cell = cellMap.get(`${departDate}::${returnDate}`);
          if (!cell) {
            return `<td><div class="matrix-cell is-empty">-</div></td>`;
          }

          const backgroundValue =
            state.matrixCabin === "ECONOMY"
              ? cell.economy_min_total
              : state.matrixCabin === "BUSINESS"
                ? cell.business_min_total
                : Math.min(
                    ...[cell.economy_min_total, cell.business_min_total].filter((value) => value !== null),
                  );
          const active =
            state.selectedCell &&
            state.selectedCell.depart_date === cell.depart_date &&
            state.selectedCell.return_date === cell.return_date;

          return `
            <td>
              <button
                type="button"
                class="matrix-cell ${active ? "is-selected" : ""}"
                style="background:${priceTone(backgroundValue, minPrice, maxPrice)}"
                data-depart="${cell.depart_date}"
                data-return="${cell.return_date}"
              >
                <div class="matrix-price-stack">
                  ${
                    state.matrixCabin !== "BUSINESS"
                      ? `<div class="matrix-price"><span>Eco</span><strong>${formatMoney(cell.economy_min_total)}</strong></div>`
                      : ""
                  }
                  ${
                    state.matrixCabin !== "ECONOMY"
                      ? `<div class="matrix-price"><span>Biz</span><strong>${formatMoney(cell.business_min_total)}</strong></div>`
                      : ""
                  }
                </div>
                <div class="matrix-meta">${cell.stay_nights}박 · ${cell.trip_bucket}</div>
              </button>
            </td>
          `;
        })
        .join("");

      return `
        <tr>
          <td>
            <div class="matrix-label">
              <strong>${formatDate(departDate)}</strong>
              <span>출발</span>
            </div>
          </td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  els.matrixTable.innerHTML = `
    <thead>
      <tr>
        <th><div class="matrix-label"><strong>출발일</strong><span>귀국일 기준 비교</span></div></th>
        ${state.calendarData.return_dates
          .map(
            (returnDate) => `
              <th>
                <div class="matrix-label">
                  <strong>${formatDate(returnDate)}</strong>
                  <span>귀국</span>
                </div>
              </th>`,
          )
          .join("")}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `;

  els.matrixTable.querySelectorAll(".matrix-cell[data-depart]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedCell = {
        depart_date: button.dataset.depart,
        return_date: button.dataset.return,
        ...visibleCells.find(
          (cell) => cell.depart_date === button.dataset.depart && cell.return_date === button.dataset.return,
        ),
      };
      renderSelectedCellCard();
      renderMatrix();
      await refreshOffers();
    });
  });
}

function renderOfferFilters() {
  const airlineItems = [{ code: "ALL", label: "전체" }];
  if (state.offersData) {
    airlineItems.push(...state.offersData.filters.available_airlines.map((item) => ({ code: item.code, label: item.name })));
  }
  renderChips(els.offerAirlineFilters, airlineItems, state.offerAirline, async (code) => {
    state.offerAirline = code;
    await refreshOffers();
  });

  const cabinItems = [
    { code: "ALL", label: "전체" },
    { code: "ECONOMY", label: "이코노미" },
    { code: "BUSINESS", label: "비즈니스" },
  ];
  renderChips(els.offerCabinFilters, cabinItems, state.offerCabin, async (code) => {
    state.offerCabin = code;
    await refreshOffers();
  });

  const stopItems = [
    { code: "ALL", label: "전체" },
    { code: "0", label: "직항" },
    { code: "1", label: "1회 경유" },
  ];
  renderChips(els.offerStopFilters, stopItems, state.offerStops, async (code) => {
    state.offerStops = code;
    await refreshOffers();
  });
}

function renderOffers() {
  renderOfferFilters();

  if (!state.selectedCell) {
    els.offersSubtitle.textContent = "날짜를 먼저 선택하세요.";
    els.offersList.innerHTML = `<div class="empty-state">매트릭스 셀을 누르면 항공편 옵션과 예약 링크가 나타납니다.</div>`;
    return;
  }

  els.offersSubtitle.textContent = `${formatDate(state.selectedCell.depart_date)} 출발 · ${formatDate(state.selectedCell.return_date)} 귀국 · 마지막 업데이트 ${formatStamp(state.offersEnvelope?.last_batch_at)} · 실제 예약가는 항공사에서 확인하세요`;

  if (!state.offersData || !state.offersData.offers.length) {
    els.offersList.innerHTML = `<div class="empty-state">선택한 조건에 맞는 항공편 옵션이 없습니다.</div>`;
    return;
  }

  els.offersList.innerHTML = state.offersData.offers
    .map(
      (offer) => `
        <article class="offer-card">
          <div class="offer-head">
            <div>
              <p class="section-kicker">${offer.airline_name} · ${offer.cabin_label_raw}</p>
              <h3>${formatMoney(offer.price_total)}</h3>
            </div>
            <a class="offer-link" href="${offer.deep_link}" target="_blank" rel="noreferrer">예약 보기</a>
          </div>
          <div class="pin-badges">
            ${offer.badges.length
              ? offer.badges
                  .map((badge) => `<span class="badge ${badge === "공식 특가" ? "promo" : "sale"}">${badge}</span>`)
                  .join("")
              : `<span class="badge neutral">표준 운임</span>`}
          </div>
          <div class="offer-grid">
            <div class="offer-fact"><span>출처</span><strong>${offer.source_name}</strong></div>
            <div class="offer-fact"><span>직항/경유</span><strong>${offer.is_direct ? "직항" : `${offer.stops}회 경유`}</strong></div>
            <div class="offer-fact"><span>운임 패밀리</span><strong>${offer.fare_family}</strong></div>
            <div class="offer-fact"><span>마지막 배치</span><strong>${formatStamp(offer.last_batch_at)}</strong></div>
            <div class="offer-fact"><span>출발</span><strong>${formatDateTime(offer.outbound_departure_at)}</strong></div>
            <div class="offer-fact"><span>도착</span><strong>${formatDateTime(offer.outbound_arrival_at)}</strong></div>
            <div class="offer-fact"><span>귀국 출발</span><strong>${formatDateTime(offer.inbound_departure_at)}</strong></div>
            <div class="offer-fact"><span>소요시간</span><strong>${offer.duration_hours}시간</strong></div>
          </div>
        </article>
      `,
    )
    .join("");
}

async function refreshMap() {
  const query = buildQuery({
    origin: state.origin,
    week: state.week,
    region: state.region,
    cabin: state.cabin,
    stay_bucket: state.stayBucket,
    traveler: state.traveler,
    airlines: state.airlines.size ? [...state.airlines].join(",") : "",
  });
  state.mapEnvelope = await fetchJson(`/api/deals/map?${query}`);
  state.mapData = state.mapEnvelope.data;
  chooseDestination();
  updateHeroMetrics();
  updateBatchStrip(state.mapEnvelope);
  renderSelectionSummary();
  renderChips(els.regionChips, state.meta.regions, state.region, async (code) => {
    state.region = code;
    state.selectedDestination = null;
    state.selectedCell = null;
    await refreshMap();
  });
  renderChips(els.cabinChips, state.meta.cabins, state.cabin, async (code) => {
    state.cabin = code;
    state.matrixCabin = code === "ALL" ? "ALL" : code;
    state.selectedCell = null;
    await refreshMap();
  });
  renderChips(els.globalBucketChips, state.meta.trip_buckets.filter((item) => item.code !== "ALL"), state.stayBucket, async (code) => {
    state.stayBucket = code;
    state.selectedDestination = null;
    state.selectedCell = null;
    await refreshMap();
  });
  renderMapPins();
  renderRegionList();
  renderAirlineFilterChips();
  await refreshCalendar();
}

async function refreshCalendar() {
  if (!state.selectedDestination) {
    state.calendarData = null;
    state.calendarEnvelope = null;
    state.selectedCell = null;
    renderMatrix();
    await refreshOffers();
    return;
  }

  const query = buildQuery({
    origin: state.origin,
    week: state.week,
    destination: state.selectedDestination,
    stay_bucket: state.stayBucket,
    traveler: state.traveler,
    airlines: state.airlines.size ? [...state.airlines].join(",") : "",
    cabin: state.cabin,
  });
  state.calendarEnvelope = await fetchJson(`/api/deals/calendar?${query}`);
  state.calendarData = state.calendarEnvelope.data;
  chooseCell();
  renderMatrix();
  await refreshOffers();
}

async function refreshOffers() {
  if (!state.selectedCell || !state.selectedDestination) {
    state.offersData = null;
    state.offersEnvelope = null;
    renderOffers();
    return;
  }

  const airlineParam = state.offerAirline !== "ALL" ? state.offerAirline : "";
  const cabinParam = state.offerCabin !== "ALL" ? state.offerCabin : "ALL";
  const stopParam = state.offerStops !== "ALL" ? state.offerStops : "ALL";

  const query = buildQuery({
    origin: state.origin,
    week: state.week,
    destination: state.selectedDestination,
    depart: state.selectedCell.depart_date,
    return: state.selectedCell.return_date,
    traveler: state.traveler,
    airline: airlineParam,
    cabin: cabinParam,
    stops: stopParam,
  });
  state.offersEnvelope = await fetchJson(`/api/offers?${query}`);
  state.offersData = state.offersEnvelope.data;
  renderOffers();
}

async function boot() {
  state.metaEnvelope = await fetchJson("/api/meta");
  state.meta = state.metaEnvelope.data;
  state.origin = state.meta.defaults.origin;
  state.region = state.meta.defaults.region;
  state.stayBucket = state.meta.defaults.stay_bucket;
  state.traveler = state.meta.defaults.traveler;
  state.cabin = state.meta.defaults.cabin;
  state.matrixCabin = state.cabin;
  state.week = state.meta.weeks[0].code;
  renderMetaControls();
  await refreshMap();
}

boot().catch((error) => {
  console.error(error);
  els.offersList.innerHTML = `<div class="empty-state">앱을 불러오지 못했습니다. 서버를 다시 실행해 주세요.</div>`;
});
