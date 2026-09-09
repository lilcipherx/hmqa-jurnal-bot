import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow = 'HMQA',
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header>
      <div className="eyebrow">{eyebrow}</div>
      <h1 tabIndex={-1}>{title}</h1>
      {description ? <p className="lede">{description}</p> : null}
      {actions}
    </header>
  );
}
