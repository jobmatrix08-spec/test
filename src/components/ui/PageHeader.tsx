import React, { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, description, actions, className, ...props }, ref) => (
    <header
      {...props}
      ref={ref}
      data-ui="page-header"
      className={cn('flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-ds-text sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ds-muted">{description}</p>}
      </div>
      {actions && <div data-ui="page-actions" className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  ),
);

PageHeader.displayName = 'PageHeader';
