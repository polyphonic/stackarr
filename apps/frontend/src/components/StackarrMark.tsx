export function StackarrMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Stackarr">
      <defs>
        <linearGradient id="stackarrMarkGradient" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c8a7ff" />
          <stop offset="0.55" stopColor="#8e54f6" />
          <stop offset="1" stopColor="#51258b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#24113d" />
      <path d="M18 19.5 32 11l14 8.5v8.8L32 19.8l-14 8.5v-8.8Z" fill="url(#stackarrMarkGradient)" />
      <path d="m18 31.2 14-8.5 14 8.5V40L32 31.5 18 40v-8.8Z" fill="#a77cff" />
      <path d="m18 43 14-8.5L46 43v2.1L32 53.5 18 45.1V43Z" fill="#f5f0ff" />
      <path d="M32 19.8v33.7" stroke="#24113d" strokeOpacity="0.22" strokeWidth="2" />
    </svg>
  );
}
