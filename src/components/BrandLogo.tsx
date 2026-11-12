import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { useBrand } from './BrandProvider';

type BrandLogoProps = {
  variant?: 'full' | 'icon' | 'mono';
  logoUrl?: string;
  className?: string;
};

function BrandMark({ logoUrl, monochrome = false }: { logoUrl: string; monochrome?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [logoUrl]);

  return logoUrl && !imageFailed ? (
    <img src={logoUrl} alt="" onError={() => setImageFailed(true)} className="h-full w-full object-contain" />
  ) : (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="h-full w-full">
      <rect x="11.5" y="5.5" width="25" height="37" rx="6.5" stroke="currentColor" strokeWidth="2.8" />
      <path d="M19 11h10" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="24" cy="36.5" r="1.5" fill="currentColor" />
      <path d="m31 28 7.5-7.5 2 2L33 30l-4 1 1-3Z" fill={monochrome ? 'currentColor' : 'var(--ds-accent)'} />
      <path d="m36.5 22.5 2 2" stroke={monochrome ? 'currentColor' : 'var(--ds-brand-contrast)'} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default function BrandLogo({ variant = 'full', logoUrl, className }: BrandLogoProps) {
  const brand = useBrand();
  const resolvedLogoUrl = logoUrl ?? brand.logo;

  if (variant === 'icon' || variant === 'mono') {
    const monochrome = variant === 'mono';
    return (
      <span
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] p-2.5',
          monochrome
            ? 'border border-ds-border bg-ds-surface text-ds-text'
            : 'bg-ds-brand text-ds-brand-contrast shadow-sm shadow-ds-brand/20',
          className,
        )}
      >
        <BrandMark logoUrl={resolvedLogoUrl} monochrome={monochrome} />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-3', className)}>
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-ds-brand p-2.5 text-ds-brand-contrast shadow-sm shadow-ds-brand/20">
        <BrandMark logoUrl={resolvedLogoUrl} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate bg-gradient-to-r from-ds-brand to-ds-accent bg-clip-text font-display text-[18px] font-extrabold leading-tight tracking-[-0.04em] text-transparent">{brand.storeName}</span>
        <span className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.12em] text-ds-muted">{brand.storeTagline}</span>
      </span>
    </span>
  );
}
