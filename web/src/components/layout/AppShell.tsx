import { Outlet } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Navbar } from './Navbar';
import { Footer } from './Footer';

/** Nav, page, footer and the toast layer: the frame every page renders inside. */
export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}
