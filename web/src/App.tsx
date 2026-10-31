import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import Home from '@/pages/Home';
import Login from '@/pages/Login';
import WaitingRoom from '@/pages/WaitingRoom';
import SeatMap from '@/pages/SeatMap';
import Checkout from '@/pages/Checkout';
import TicketPage from '@/pages/TicketPage';
import Admin from '@/pages/Admin';
import MissionControl from '@/pages/MissionControl';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/events/:eventId/queue" element={<WaitingRoom />} />
        <Route path="/events/:eventId/seats" element={<SeatMap />} />
        <Route path="/events/:eventId/checkout" element={<Checkout />} />
        <Route path="/orders/:orderId" element={<TicketPage />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/mission-control" element={<MissionControl />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
