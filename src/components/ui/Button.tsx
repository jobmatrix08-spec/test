import React, { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border border-ds-brand bg-ds-brand text-ds-brand-contrast hover:bg-ds-brand-hover',
  secondary: 'border border-ds-border bg-ds-surface text-ds-text hover:bg-ds-surface-2',
  ghost: 'border border-transparent bg-transparent text-ds-text hover:bg-ds-surface-2',
  danger: 'border border-ds-danger bg-ds-danger text-ds-brand-contrast hover:brightness-90',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 text-xs',
  md: 'px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size = 'md', loading = false, disabled, className, children, type = 'button', ...props }, ref) => {
    const resolvedVariant = variant ?? (type === 'submit' ? 'primary' : 'secondary');

    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-ds-variant={resolvedVariant}
        className={cn(
          'inline-flex min-h-ds-touch-target items-center justify-center gap-2 rounded-ds-md font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-brand disabled:cursor-not-allowed disabled:opacity-75',
          variantClasses[resolvedVariant],
          sizeClasses[size],
          className,
        )}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-e-transparent"
          />
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
