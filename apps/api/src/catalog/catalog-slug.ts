export function catalogSlugBase(
  name: string,
  maxLength: number,
  fallback: string,
): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug || fallback).slice(0, maxLength).replace(/-+$/g, "") || fallback;
}

export function catalogSlugCandidate(
  base: string,
  suffix: number,
  maxLength: number,
): string {
  if (suffix === 1) return base;
  const ending = `-${suffix}`;
  const prefix = base.slice(0, maxLength - ending.length).replace(/-+$/g, "");
  return `${prefix}${ending}`;
}

export async function findAvailableCatalogSlug(
  name: string,
  options: {
    maxLength: number;
    fallback: string;
    isTaken(slug: string): Promise<boolean>;
  },
): Promise<string> {
  const base = catalogSlugBase(name, options.maxLength, options.fallback);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = catalogSlugCandidate(base, suffix, options.maxLength);
    if (!(await options.isTaken(candidate))) return candidate;
  }
}
