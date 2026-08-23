export const ORIGIN_COORDS: Record<string, [number, number]> = {
  SEL: [126.9780, 37.5665],
  ICN: [126.4407, 37.4602],
  GMP: [126.7906, 37.5583],
  PUS: [128.9383, 35.1795],
  CJU: [126.4930, 33.5113],
};

export const STAY_BUCKET_LABELS: Record<string, string> = {
  "3_4": "3-4박",
  "5_7": "5-7박",
  "8_14": "8-14박",
};

export function formatFareShort(value: number | null) {
  if (value === null) return "-";
  if (value >= 10000) {
    const man = value / 10000;
    return man % 1 === 0 ? `${man}만` : `${man.toFixed(1)}만`;
  }
  return `${Math.round(value / 1000)}천`;
}

export function interpolateGreatCircle(start: [number, number], end: [number, number], points = 40): [number, number][] {
  const [lon1, lat1] = start.map((deg) => (deg * Math.PI) / 180);
  const [lon2, lat2] = end.map((deg) => (deg * Math.PI) / 180);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat1 - lat2) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon1 - lon2) / 2) ** 2
      )
    );
  if (d === 0) return [start, end];

  const arc: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const f = i / points;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x ** 2 + y ** 2));
    const lon = Math.atan2(y, x);
    arc.push([(lon * 180) / Math.PI, (lat * 180) / Math.PI]);
  }
  return arc;
}

export function originCoordFor(origin: string): [number, number] {
  return ORIGIN_COORDS[origin] ?? ORIGIN_COORDS.ICN;
}
