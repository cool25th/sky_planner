"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function MapFilterSelect({
  id,
  label,
  defaultValue,
  paramName,
  options,
}: {
  id: string;
  label: string;
  defaultValue: string;
  paramName: string;
  options: { code: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set(paramName, val);
    router.push(`/map?${nextParams.toString()}`);
  };

  return (
    <div className="filter-dropdown">
      <label htmlFor={id} className="filter-label">{label}</label>
      <select
        id={id}
        value={defaultValue}
        className="filter-select"
        onChange={handleChange}
      >
        {options.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
