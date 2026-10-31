import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-page flex-col gap-3 px-gutter py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between lg:px-gutter-lg">
        <Logo />
        <p>
          A portfolio project. Events, venues and artwork are invented; no real
          brands or artists are represented.
        </p>
      </div>
    </footer>
  );
}
