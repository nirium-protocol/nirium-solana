// The Nirium N, from nirium.xyz/branding-nirium/svg/icon.svg (one stroke, three dots for payment,
// audit and agent rails). Gold on nirium.xyz; here in Solana purple #9945FF to green #14F195 (solana.com/branding). Decorative here: the link around it carries the name.
export function Logo() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="chainSolana" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M25,85 L25,15 L75,85 L75,15" fill="none" stroke="url(#chainSolana)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="15" r="7" fill="var(--dot)" />
      <circle cx="50" cy="50" r="7" fill="var(--dot)" />
      <circle cx="75" cy="85" r="7" fill="var(--dot)" />
    </svg>
  );
}
