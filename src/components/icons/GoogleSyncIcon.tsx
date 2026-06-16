'use client';

interface Props {
  className?: string;
}

export default function GoogleSyncIcon({ className = '' }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-6 w-6 items-center justify-center text-[22px] font-bold leading-none ${className}`}
    >
      <span
        className="bg-[conic-gradient(from_35deg,#4285f4_0deg_85deg,#34a853_85deg_150deg,#fbbc05_150deg_230deg,#ea4335_230deg_310deg,#4285f4_310deg_360deg)] bg-clip-text text-transparent"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        G
      </span>
    </span>
  );
}
