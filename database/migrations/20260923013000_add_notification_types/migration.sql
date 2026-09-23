-- STEP 24: notification types for events the original enum had no value for.
--
-- Folding order cancellations and review decisions into SYSTEM would make the
-- feed impossible to filter by topic, so the meaning goes in the enum where it
-- can be queried, not into the JSON payload.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ORDER_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REVIEW_UPDATE';
