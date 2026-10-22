import { Easing, interpolate, useCurrentFrame } from "remotion";
import { CURSOR_GET, CURSOR_REQUEST, TL } from "../timeline";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

function move(frame: number, from: number, to: number, a: number, b: number) {
  const t = interpolate(frame, [from, to], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  });
  return {
    x: interpolate(t, [0, 1], [a, b]),
    y: 0,
  };
}

export function Cursor() {
  const frame = useCurrentFrame();

  const toGet = move(frame, TL.cursorIn.from, TL.cursorIn.to, 1240, CURSOR_GET.x);
  const yGet = interpolate(
    interpolate(frame, [TL.cursorIn.from, TL.cursorIn.to], [0, 1], {
      ...clamp,
      easing: Easing.bezier(0.33, 0, 0.2, 1),
    }),
    [0, 1],
    [860, CURSOR_GET.y]
  );

  const toRequest = move(
    frame,
    TL.cursorToRequest.from,
    TL.cursorToRequest.to,
    CURSOR_GET.x,
    CURSOR_REQUEST.x
  );
  const yRequest = interpolate(
    interpolate(frame, [TL.cursorToRequest.from, TL.cursorToRequest.to], [0, 1], {
      ...clamp,
      easing: Easing.bezier(0.33, 0, 0.2, 1),
    }),
    [0, 1],
    [CURSOR_GET.y, CURSOR_REQUEST.y]
  );

  const x = frame < TL.cursorToRequest.from ? toGet.x : toRequest.x;
  const y = frame < TL.cursorToRequest.from ? yGet : yRequest;

  const clickGet = interpolate(
    frame,
    [TL.clickGet - 2, TL.clickGet, TL.clickGet + 5],
    [1, 0.78, 1],
    clamp
  );
  const clickRequest = interpolate(
    frame,
    [TL.clickRequest - 2, TL.clickRequest, TL.clickRequest + 5],
    [1, 0.78, 1],
    clamp
  );

  const opacity = interpolate(
    frame,
    [0, 8, TL.clickRequest + 6, TL.clickRequest + 18],
    [0, 1, 1, 0],
    clamp
  );

  const ring = (at: number) => {
    const p = interpolate(frame, [at, at + 18], [0, 1], clamp);
    return (
      <div
        key={at}
        style={{
          position: "absolute",
          left: -18,
          top: -18,
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "2px solid var(--tw-accent)",
          opacity: frame >= at ? (1 - p) * 0.8 : 0,
          transform: `scale(${0.3 + p * 1.15})`,
        }}
      />
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 28,
        height: 34,
        opacity,
        zIndex: 60,
        transform: `scale(${frame < TL.clickRequest + 2 ? clickGet : clickRequest})`,
        filter: "drop-shadow(0 5px 12px oklch(0% 0 0 / 0.55))",
      }}
    >
      {ring(TL.clickGet)}
      {ring(TL.clickRequest)}
      <svg width="28" height="34" viewBox="0 0 28 34" fill="none">
        <path
          d="M3 2.5L24 17.2l-9.6 1.9 4.9 10.1-4.1 2-4.9-10.1-7.2 6.6V2.5z"
          fill={frame < TL.clickRequest + 2 ? "#ffffff" : "#f4f4f5"}
          stroke="oklch(20% 0.01 260)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
