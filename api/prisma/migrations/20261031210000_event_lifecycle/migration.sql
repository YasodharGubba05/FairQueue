-- Terminal states. An event in either of these leaves public listings and can
-- never be bought for again; its orders and tickets are untouched.
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
