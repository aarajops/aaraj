import type { MouseEventHandler, ReactNode } from "react";
import Link from "next/link";

type StorefrontLinkProps = {
  href: string;
  children: ReactNode;
  className: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export function StorefrontLink({
  href,
  children,
  className,
  onClick,
}: StorefrontLinkProps) {
  if (href.startsWith("/")) {
    return (
      <Link className={className} href={href} onClick={onClick}>
        {children}
      </Link>
    );
  }

  return (
    <a
      className={className}
      href={href}
      onClick={onClick}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
