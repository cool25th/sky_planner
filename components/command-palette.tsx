"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { href } from "@/lib/url";

interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  category: "목적지" | "페이지" | "기능";
  icon: string;
  action: () => void;
  keywords: string[];
}

const DESTINATIONS = [
  { code: "TYO", city: "도쿄", country: "일본", region: "동아시아", icon: "🗼" },
  { code: "OSA", city: "오사카", country: "일본", region: "동아시아", icon: "🏯" },
  { code: "FUK", city: "후쿠오카", country: "일본", region: "동아시아", icon: "🍜" },
  { code: "BKK", city: "방콕", country: "태국", region: "동남아", icon: "🛕" },
  { code: "DAD", city: "다낭", country: "베트남", region: "동남아", icon: "🏖️" },
  { code: "TPE", city: "타이베이", country: "대만", region: "동아시아", icon: "🧋" },
  { code: "HKG", city: "홍콩", country: "홍콩", region: "동아시아", icon: "🏙️" },
  { code: "SIN", city: "싱가포르", country: "싱가포르", region: "동남아", icon: "🦁" },
  { code: "DPS", city: "발리", country: "인도네시아", region: "동남아", icon: "🌴" },
  { code: "CEB", city: "세부", country: "필리핀", region: "동남아", icon: "🏊" },
  { code: "GUM", city: "괌", country: "미국", region: "대양주", icon: "🌺" },
  { code: "PAR", city: "파리", country: "프랑스", region: "유럽", icon: "🥐" },
  { code: "LON", city: "런던", country: "영국", region: "유럽", icon: "🎡" },
  { code: "ROM", city: "로마", country: "이탈리아", region: "유럽", icon: "🏛️" },
  { code: "BCN", city: "바르셀로나", country: "스페인", region: "유럽", icon: "⚽" },
  { code: "NYC", city: "뉴욕", country: "미국", region: "미주", icon: "🗽" },
  { code: "HNL", city: "호놀룰루/하와이", country: "미국", region: "미주", icon: "🏄" },
  { code: "SYD", city: "시드니", country: "호주", region: "대양주", icon: "🦘" },
];

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleOpen = () => {
    setIsOpen(true);
    setQuery("");
    setSelectedIndex(0);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "/" && !isOpen && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const items: CommandItem[] = [
    // Pages
    {
      id: "page-map",
      title: "특가 지도 탐색",
      subtitle: "지도 위에서 전 세계 항공권 최저가 탐색",
      category: "페이지",
      icon: "🗺️",
      action: () => router.push("/map"),
      keywords: ["지도", "특가", "map", "탐색", "세계지도"],
    },
    {
      id: "page-policies",
      title: "가격 및 환불 정책 안내",
      subtitle: "수하물, 유류할증료, 취소 수수료 안내",
      category: "페이지",
      icon: "📜",
      action: () => router.push("/policies"),
      keywords: ["정책", "가격", "환불", "취소", "수수료"],
    },
    // Destinations
    ...DESTINATIONS.map((d) => ({
      id: `dest-${d.code}`,
      title: `${d.city} (${d.code})`,
      subtitle: `${d.country} · ${d.region} 항공권 날짜 매트릭스`,
      category: "목적지" as const,
      icon: d.icon,
      action: () => router.push(href(`/destination/${d.code}`, { origin: "SEL" })),
      keywords: [d.city, d.code, d.country, d.region, d.city.toLowerCase(), d.code.toLowerCase()],
    })),
  ];

  const filtered = query.trim()
    ? items.filter((item) => {
        const q = query.toLowerCase().trim();
        return (
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.toLowerCase().includes(q))
        );
      })
    : items;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleItemSelect = (item: CommandItem) => {
    handleClose();
    item.action();
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      handleItemSelect(filtered[selectedIndex]);
    }
  };

  return (
    <>
      <button
        type="button"
        className="cmd-trigger-btn"
        onClick={handleOpen}
        title="빠른 검색 (단축키: Cmd + K)"
        aria-label="빠른 검색"
      >
        <span>🔍</span>
        <span style={{ fontSize: "0.8rem" }}>검색</span>
        <kbd className="cmd-palette-kbd">⌘K</kbd>
      </button>

      {isOpen && (
        <div className="cmd-palette-overlay" onClick={handleClose} role="presentation">
          <div
            className="cmd-palette-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            onKeyDown={handleListKeyDown}
          >
            <div className="cmd-palette-search">
              <span className="cmd-palette-icon">🔍</span>
              <input
                ref={inputRef}
                type="text"
                className="cmd-palette-input"
                placeholder="어디로 떠나시나요? (도시명, 공항코드, 국가 검색...)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd className="cmd-palette-kbd">ESC</kbd>
            </div>

            <div className="cmd-palette-list">
              {filtered.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)" }}>
                  검색 결과가 없습니다.
                </div>
              ) : (
                filtered.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`cmd-palette-item ${idx === selectedIndex ? "is-selected" : ""}`}
                    onClick={() => handleItemSelect(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "1.2rem" }}>{item.icon}</span>
                      <div>
                        <strong style={{ fontSize: "0.95rem" }}>{item.title}</strong>
                        <div style={{ fontSize: "0.76rem", color: "var(--color-text-tertiary)" }}>
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: "var(--color-surface-subtle)",
                        color: "var(--color-text-tertiary)",
                        fontWeight: 600,
                      }}
                    >
                      {item.category}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="cmd-palette-footer">
              <span>↑↓ 이동 · ↵ 선택</span>
              <span>Sky Planner Atlas Navigator</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
