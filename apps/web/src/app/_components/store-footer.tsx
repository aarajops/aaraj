import { getPublishedProductFilterOptions } from "@/features/catalog/catalog-queries";
import { StorefrontBrandLogo } from "@/features/storefront/storefront-brand-logo";
import { StorefrontLink } from "@/features/storefront/storefront-link";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

const socialNames = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
} as const;

type FooterLink = { href: string; label: string };

export async function StoreFooter() {
  const [settings, productFilters] = await Promise.all([
    getPublicStorefrontSettings(),
    getPublishedProductFilterOptions(),
  ]);
  const socialLinks = Object.entries(settings.socialLinks)
    .flatMap(([platform, href]) =>
      href
        ? [
            {
              href,
              label: socialNames[platform as keyof typeof socialNames],
            },
          ]
        : [],
    )
    .sort(compareLabels);
  const aboutLinks = [...settings.footerLinkGroups.about].sort(compareLabels);
  const policyLinks = [...settings.footerLinkGroups.policies].sort(
    compareLabels,
  );
  const selectedCategoryIds = new Set(settings.footerCategoryIds);
  const categories = (productFilters?.categories ?? [])
    .filter(({ id }) => selectedCategoryIds.has(id))
    .map(({ name, publishedProductCount, slug }) => ({
      href: `/shop/categories/${slug}`,
      label: `${name} (${publishedProductCount})`,
    }));
  const contactDetails = Boolean(
    settings.footerDescription ||
    settings.supportEmail ||
    settings.supportPhone ||
    settings.businessAddress,
  );

  return (
    <footer className="dark mt-auto border-t border-border bg-background text-foreground">
      <div className="container mx-auto grid w-full gap-x-8 gap-y-10 px-5 py-10 sm:grid-cols-2 lg:grid-cols-3 lg:px-0 xl:grid-cols-5">
        <section
          aria-label={`${settings.siteName} footer brand and social links`}
          className="grid content-start gap-6"
        >
          <StorefrontBrandLogo
            imageClassName="h-10 max-w-48"
            inverseFallback
            loading="lazy"
            logo={settings.logo}
            siteName={settings.siteName}
          />
          <FooterNavigation label="Social Media" links={socialLinks} />
        </section>
        <FooterNavigation label="Categories" links={categories} />
        <FooterNavigation label="About Us" links={aboutLinks} />
        <FooterNavigation label="Policies" links={policyLinks} />

        {contactDetails && (
          <section aria-labelledby="store-footer-contacts-heading">
            <h2
              className="text-sm font-semibold"
              id="store-footer-contacts-heading"
            >
              Contacts
            </h2>
            {settings.footerDescription && (
              <p className="mt-4 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                {settings.footerDescription}
              </p>
            )}
            <address className="mt-4 grid gap-3 text-sm not-italic text-muted-foreground">
              {settings.supportEmail && (
                <a
                  className="w-fit hover:text-foreground"
                  href={`mailto:${settings.supportEmail}`}
                >
                  {settings.supportEmail}
                </a>
              )}
              {settings.supportPhone && (
                <a
                  className="w-fit hover:text-foreground"
                  href={`tel:${settings.supportPhone}`}
                >
                  {settings.supportPhone}
                </a>
              )}
              {settings.businessAddress && (
                <p className="whitespace-pre-line">
                  {settings.businessAddress}
                </p>
              )}
            </address>
          </section>
        )}
      </div>
      <div className="border-t border-border px-5 py-4 text-center text-sm text-muted-foreground">
        Copyright © {new Date().getFullYear()} {settings.siteName}. All rights
        reserved.
      </div>
    </footer>
  );
}

function FooterNavigation({
  label,
  links,
}: {
  label: string;
  links: FooterLink[];
}) {
  if (links.length === 0) return null;

  return (
    <nav aria-label={label}>
      <h2 className="text-sm font-semibold">{label}</h2>
      <ul className="mt-4 grid gap-3 text-sm text-muted-foreground">
        {links.map(({ href, label: linkLabel }) => (
          <li key={`${linkLabel}:${href}`}>
            <StorefrontLink className="hover:text-foreground" href={href}>
              {linkLabel}
            </StorefrontLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function compareLabels(left: FooterLink, right: FooterLink) {
  const leftLabel = left.label.toLowerCase();
  const rightLabel = right.label.toLowerCase();
  if (leftLabel < rightLabel) return -1;
  if (leftLabel > rightLabel) return 1;
  return left.href < right.href ? -1 : left.href > right.href ? 1 : 0;
}
