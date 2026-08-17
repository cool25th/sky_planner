"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sky_planner_theme");
      if (saved === "dark" || saved === "light") {
        setTheme(saved);
        document.documentElement.setAttribute("data-theme", saved);
      } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch {
      // storage/media error
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sky_planner_theme", next);
    } catch {
      // storage error
    }
  };

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={`테마 변경 (현재: ${theme === "dark" ? "다크 모드" : "라이트 모드"})`}
      title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      <span className="theme-toggle-icon">{theme === "dark" ? "🌙" : "☀️"}</span>
    </button>
  );
}
