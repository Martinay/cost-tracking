import type { ReactNode } from "react";

export function PageHeading({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">Your stable, in balance</p>
        <h1 id={id}>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
