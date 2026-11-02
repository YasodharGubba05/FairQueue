import { useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/store/toast';

/**
 * Follow or unfollow an event.
 *
 * Optimistic, because the answer is never in doubt from the user's point of
 * view and a bell that waits half a second to fill in feels broken. If the
 * server disagrees the state goes back and they are told why.
 */
export function FollowButton({
  eventId,
  eventName,
  following,
  size = 'sm',
  onChange,
}: {
  eventId: string;
  eventName: string;
  following: boolean;
  size?: 'sm' | 'md';
  onChange?: (following: boolean) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const [isFollowing, setIsFollowing] = useState(following);
  const [pending, setPending] = useState(false);

  // Following is personal, so there is nothing to show a signed-out visitor.
  if (!user) return null;

  async function toggle(e: React.MouseEvent) {
    // These sit inside event cards that are themselves links.
    e.preventDefault();
    e.stopPropagation();

    const next = !isFollowing;
    setIsFollowing(next);
    setPending(true);

    try {
      if (next) await api.post(`/api/events/${eventId}/follow`);
      else await api.del(`/api/events/${eventId}/follow`);
      onChange?.(next);
    } catch (err) {
      setIsFollowing(!next);
      toast.error(
        err instanceof ApiError ? err.message : 'Could not reach the server',
        next ? `Not following ${eventName}` : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant={isFollowing ? 'subtle' : 'outline'}
      size={size}
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFollowing}
      aria-label={isFollowing ? `Stop following ${eventName}` : `Follow ${eventName}`}
    >
      {isFollowing ? <BellRing aria-hidden /> : <Bell aria-hidden />}
      {isFollowing ? 'Following' : 'Follow'}
    </Button>
  );
}
