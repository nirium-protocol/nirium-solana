// The Nirium N, copied from nirium.xyz/branding-nirium/svg/icon.svg (one gold stroke, three dots for
// payment, audit and agent rails). Decorative here: the link around it carries the name.
export function Logo() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="niriumGold" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F5D57A" />
          <stop offset="0.5" stopColor="#D4AF37" />
          <stop offset="1" stopColor="#8B6F2E" />
        </linearGradient>
      </defs>
      <path d="M25,85 L25,15 L75,85 L75,15" fill="none" stroke="url(#niriumGold)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="15" r="7" fill="var(--dot)" />
      <circle cx="50" cy="50" r="7" fill="var(--dot)" />
      <circle cx="75" cy="85" r="7" fill="var(--dot)" />
    </svg>
  );
}
