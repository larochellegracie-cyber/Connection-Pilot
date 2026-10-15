type PilotAvatarProps = {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  state?: 'idle' | 'thinking' | 'speaking';
};

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-11 w-11',
  lg: 'h-16 w-16'
} as const;

export default function PilotAvatar({ className = '', size = 'md', state = 'idle' }: PilotAvatarProps) {
  return (
    <span
      className={`pilot-avatar pilot-avatar-${state} inline-flex shrink-0 items-center justify-center ${sizeClasses[size]} ${className}`}
      role="img"
      aria-label="Pilot"
    >
      <svg viewBox="0 0 64 64" className="h-full w-full overflow-visible" aria-hidden="true" focusable="false">
        <g stroke="hsl(var(--secondary))" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M20.5 37.5c-6.2-1.1-10.4-5.5-10.4-11.4 0-4.4 2.4-8.4 6.2-10.3 2.4-1.2 5 0 5 2.7v16.1"
            fill="hsl(var(--card))"
            strokeWidth="3.2"
          />
          <path
            d="M32.7 6.4c-10 0-16.4 7.1-16.4 17.4v15.6c0 11.2 7.2 18.2 16.4 18.2s16.4-7 16.4-18.2V23.8c0-10.3-6.4-17.4-16.4-17.4Z"
            fill="hsl(var(--card))"
            strokeWidth="3.2"
          />
          <ellipse cx="27.6" cy="28.6" rx="2.25" ry="3.8" fill="hsl(var(--secondary))" stroke="none" />
          <ellipse cx="37.8" cy="28.6" rx="2.25" ry="3.8" fill="hsl(var(--secondary))" stroke="none" />
        </g>
        <g stroke="hsl(var(--primary))" strokeWidth="2.7" strokeLinecap="round">
          <path d="M50.4 15.8 55.1 12.3" />
          <path d="M52.3 21.7h5.5" />
          <path d="M50.4 27.6l4.7 3.5" />
        </g>
      </svg>
    </span>
  );
}
