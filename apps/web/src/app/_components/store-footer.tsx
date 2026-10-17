import { StorefrontBrandLogo } from "@/features/storefront/storefront-brand-logo";
import { StorefrontLink } from "@/features/storefront/storefront-link";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

const socialNames = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
} as const;

export async function StoreFooter() {
  const settings = await getPublicStorefrontSettings();
  const socialLinks = Object.entries(settings.socialLinks).flatMap(
    ([platform, href]) =>
      href
        ? [
            {
              href,
              label: socialNames[platform as keyof typeof socialNames],
            },
          ]
        : [],
  );

  return (
    <footer className="mt-auto border-t border-border bg-neutral-950 text-white">
      <div className="container mx-auto grid gap-8 px-5 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <section aria-label={`${settings.siteName} information`}>
          <StorefrontBrandLogo
            imageClassName="h-12 max-w-48"
            inverseFallback
            logo={settings.logo}
            siteName={settings.siteName}
          />
          {settings.footerDescription && (
            <p className="mt-4 max-w-sm whitespace-pre-line text-sm leading-6 text-neutral-300">
              {settings.footerDescription}
            </p>
          )}
        </section>

        {(settings.supportEmail ||
          settings.supportPhone ||
          settings.businessAddress) && (
          <section aria-labelledby="store-footer-contact-heading">
            <h2
              className="text-sm font-semibold uppercase tracking-wider"
              id="store-footer-contact-heading"
            >
              Contact
            </h2>
            <address className="mt-4 grid gap-3 text-sm not-italic text-neutral-300">
              {settings.supportEmail && (
                <a
                  className="w-fit hover:text-white"
                  href={`mailto:${settings.supportEmail}`}
                >
                  {settings.supportEmail}
                </a>
              )}
              {settings.supportPhone && (
                <a
                  className="w-fit hover:text-white"
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

        {settings.footerLinks.length > 0 && (
          <nav aria-label="Footer links">
            <h2 className="text-sm font-semibold uppercase tracking-wider">
              Information
            </h2>
            <ul className="mt-4 grid gap-3 text-sm text-neutral-300">
              {settings.footerLinks.map(({ href, label }) => (
                <li key={`${label}:${href}`}>
                  <StorefrontLink className="hover:text-white" href={href}>
                    {label}
                  </StorefrontLink>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {socialLinks.length > 0 && (
          <nav aria-label="Social media">
            <h2 className="text-sm font-semibold uppercase tracking-wider">
              Follow us
            </h2>
            <ul className="mt-4 grid gap-3 text-sm text-neutral-300">
              {socialLinks.map(({ href, label }) => (
                <li key={label}>
                  <a
                    className="hover:text-white"
                    href={href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      <div className="border-t border-white/15 px-5 py-4 text-center text-xs text-neutral-400">
        © {new Date().getFullYear()} {settings.siteName}
      </div>
    </footer>
  );
}
