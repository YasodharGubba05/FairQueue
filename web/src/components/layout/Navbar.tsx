import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, LogOut, Menu, Settings, Ticket, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

type NavItem = { to: string; label: string; icon: typeof Ticket; adminOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Events', icon: Ticket },
  { to: '/mission-control', label: 'Mission Control', icon: Activity },
  { to: '/admin', label: 'Admin', icon: Settings, adminOnly: true },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const location = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'ADMIN');

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-nav max-w-page items-center gap-3 px-gutter lg:px-gutter-lg">
        <Link to="/" className="rounded-md">
          <Logo />
        </Link>

        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-surface-raised text-foreground' : 'text-muted hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          {user ? (
            <>
              <span className="hidden max-w-[14ch] truncate text-sm text-muted sm:inline">
                {user.email}
              </span>
              <Button variant="ghost" size="icon" onClick={clear} aria-label="Sign out">
                <LogOut aria-hidden />
              </Button>
            </>
          ) : (
            <Button asChild size="sm" variant="gradient" className="hidden sm:inline-flex">
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
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-border bg-background md:hidden"
          >
            <div className="flex flex-col gap-1 p-gutter">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium',
                      isActive ? 'bg-surface-raised text-foreground' : 'text-muted',
                    )
                  }
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </NavLink>
              ))}
              {!user ? (
                <Button asChild variant="gradient" className="mt-1">
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
