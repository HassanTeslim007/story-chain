"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

// Always white-on-black regardless of app theme - QR scanners need strong,
// predictable contrast, and re-theming the modules risks breaking that on
// Stage's dark background. The white padded card is the accommodation.
export default function QRCode({ value, size = 112 }: { value: string; size?: number }) {
  const { d, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const moduleCount = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) path += `M${col},${row}h1v1h-1z`;
      }
    }
    return { d: path, count: moduleCount };
  }, [value]);

  return (
    <div className="inline-block bg-white p-2 rounded-md">
      <svg
        viewBox={`0 0 ${count} ${count}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR code to join this game"
      >
        <path d={d} fill="black" />
      </svg>
    </div>
  );
}
