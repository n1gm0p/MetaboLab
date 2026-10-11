/** Shared artwork for generated PNG icons (rendered by next/og at build time). */
export function AppIcon({ size, rounded = true }: { size: number; rounded?: boolean }) {
  const s = size / 512;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        background: "#0b0b0f",
        borderRadius: rounded ? 112 * s : 0,
        position: "relative",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 512 512">
        <g fill="none" stroke="#2997ff" strokeWidth="22" strokeLinecap="round">
          <circle cx="150" cy="160" r="50" />
          <circle cx="362" cy="160" r="50" />
          <circle cx="256" cy="380" r="50" />
          <path d="M192 192l40 34M320 192l-40 34M256 286v44" />
        </g>
        <rect x="226" y="226" width="60" height="60" rx="12" transform="rotate(45 256 256)" fill="#30d39f" />
      </svg>
    </div>
  );
}
