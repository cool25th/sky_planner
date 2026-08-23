"use client";

import { useEffect, useRef } from "react";

export function MatrixKeyboardNavigator({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl?.classList.contains("matrix-cell-link")) return;

      const currentCell = activeEl.closest("td");
      const currentRow = currentCell?.closest("tr");
      const tbody = currentRow?.closest("tbody");
      if (!currentCell || !currentRow || !tbody) return;

      const cellsInRow = Array.from(currentRow.querySelectorAll("td"));
      const colIndex = cellsInRow.indexOf(currentCell);
      const rows = Array.from(tbody.querySelectorAll("tr"));
      const rowIndex = rows.indexOf(currentRow);

      let targetCell: HTMLTableCellElement | undefined;

      switch (e.key) {
        case "ArrowRight":
          if (colIndex < cellsInRow.length - 1) {
            targetCell = cellsInRow[colIndex + 1];
          }
          break;
        case "ArrowLeft":
          if (colIndex > 0) {
            targetCell = cellsInRow[colIndex - 1];
          }
          break;
        case "ArrowDown":
          if (rowIndex < rows.length - 1) {
            const nextRowCells = Array.from(rows[rowIndex + 1].querySelectorAll("td"));
            targetCell = nextRowCells[colIndex];
          }
          break;
        case "ArrowUp":
          if (rowIndex > 0) {
            const prevRowCells = Array.from(rows[rowIndex - 1].querySelectorAll("td"));
            targetCell = prevRowCells[colIndex];
          }
          break;
        default:
          return;
      }

      if (targetCell) {
        const link = targetCell.querySelector<HTMLElement>(".matrix-cell-link:not(.muted)");
        if (link) {
          e.preventDefault();
          link.focus();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div ref={containerRef} className="matrix-keyboard-wrapper">
      {children}
    </div>
  );
}
