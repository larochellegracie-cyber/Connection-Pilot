import { Link } from 'react-router';
import { site } from 'virtual:content';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-primary bg-secondary text-secondary-foreground">
      <div className="mx-auto max-w-content px-5 py-lg lg:px-8">
        <div className="flex flex-col gap-base md:flex-row md:items-center md:justify-between">
          <Link to="/" className="inline-flex w-fit items-center" aria-label="Connection Pilot home">
            <img
              src="/airo-assets/images/logo/horizontal/dark"
              alt="Connection Pilot"
              width={196}
              height={48}
              className="block h-auto max-h-10 w-auto max-w-full object-contain"
            />
          </Link>
          <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold">
            <Link to="/features" className="transition-colors hover:text-primary">{site.megaNavigation.product.label}</Link>
            <Link to="/about" className="transition-colors hover:text-primary">{site.megaNavigation.company.label}</Link>
            <Link to={site.navigation[0].href} className="transition-colors hover:text-primary">{site.navigation[0].label}</Link>
            <Link to="/how-it-works" className="transition-colors hover:text-primary">{site.megaNavigation.resources.label}</Link>
          </nav>
        </div>
        <div className="mt-base border-t border-primary pt-base">
          <p className="text-sm text-secondary-foreground">{site.footer.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
