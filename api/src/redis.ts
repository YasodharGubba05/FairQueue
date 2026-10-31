import Redis from 'ioredis';
import { env } from './env';

/**
 * One command connection for normal work. Socket.io's Redis adapter needs its
 * own pair of connections because a subscribed connection cannot run commands.
 */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export function createPubSubPair() {
  const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  return { pub, sub };
}
