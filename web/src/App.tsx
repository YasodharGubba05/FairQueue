import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { SessionGate } from '@/components/auth/SessionGate';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import AuthCallback from '@/pages/AuthCallback';
import WaitingRoom from '@/pages/WaitingRoom';
import SeatMap from '@/pages/SeatMap';
import Checkout from '@/pages/Checkout';
import TicketPage from '@/pages/TicketPage';
import Wallet from '@/pages/Wallet';
import TicketDetail from '@/pages/TicketDetail';
import VerifyTicket from '@/pages/VerifyTicket';
import Admin from '@/pages/Admin';
import MissionControl from '@/pages/MissionControl';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    // Restores the session from the refresh cookie before anything decides
    // whether you are signed in.
    <SessionGate>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/mission-control" element={<MissionControl />} />
          {/* Public: a door scanner has no account. */}
          <Route path="/verify/:ticketId" element={<VerifyTicket />} />

          {/* Buying needs an account: a queue place belongs to one. */}
          <Route
            path="/events/:eventId/queue"
            element={
              <ProtectedRoute>
                <WaitingRoom />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events/:eventId/seats"
            element={
              <ProtectedRoute>
                <SeatMap />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events/:eventId/checkout"
            element={
              <ProtectedRoute>
                <Checkout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:orderId"
            element={
              <ProtectedRoute>
                <TicketPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/wallet"
            element={
              <ProtectedRoute>
                <Wallet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets/:ticketId"
            element={
              <ProtectedRoute>
                <TicketDetail />
              </ProtectedRoute>
            }
          />

          {/* Convenience only. The endpoints behind this check the role
              themselves, and that is what actually protects them. */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute role="ADMIN">
                <Admin />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SessionGate>
  );
}
