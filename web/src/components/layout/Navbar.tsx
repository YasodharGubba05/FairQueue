import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { logout } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

type NavItem = { to: string; label: string; adminOnly?: boolean; signedInOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Events' },
  { to: '/wallet', label: 'Wallet', signedInOnly: true },
  { to: '/mission-control', label: 'Mission Control' },
  { to: '/admin', label: 'Admin', adminOnly: true },
];

/**
 * The nav is transparent and borderless at the top of a page and only grows a
 * hairline once you scroll, so a full-height hero opens with nothing across it.
 */
export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const items = NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || user?.role === 'ADMIN') && (!item.signedInOnly || Boolean(user)),
  );

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-[var(--dur)]',
        // Nearly opaque rather than a light wash: at 80% the page bled through
        // the blur and the nav read as a smudge over the content.
        scrolled ? 'border-b bg-background/95 backdrop-blur-xl' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-nav max-w-page items-center gap-10 px-gutter lg:px-gutter-lg">
        <Link to="/" className="rounded-sm">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'text-sm transition-colors duration-[var(--dur-fast)]',
                  isActive ? 'text-foreground' : 'text-muted hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <span className="hidden max-w-[16ch] truncate text-sm text-muted sm:inline">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm" variant="subtle" className="hidden sm:inline-flex">
              <Link to="/login">Sign in</Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <motion.nav
            id="mobile-nav"
            aria-label="Main"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden border-t bg-background md:hidden"
          >
            <div className="flex flex-col px-gutter py-2">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'border-b py-4 font-display text-xl font-light last:border-b-0',
                      isActive ? 'text-foreground' : 'text-muted',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {!user ? (
                <Button asChild variant="solid" className="my-4">
                  <Link to="/login">Sign in</Link>
                </Button>
              ) : null}
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
