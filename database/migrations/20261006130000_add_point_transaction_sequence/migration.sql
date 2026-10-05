-- ============================================================================
-- STEP 42: a real insertion order for the points ledger
--
-- Two rows written in the same transaction (refund the redeemed points + take back
-- the earned points when an order is cancelled) get exactly the same "createdAt",
-- because PostgreSQL's CURRENT_TIMESTAMP is the transaction start time, and the
-- uuid v7 ids are not guaranteed to sort within one millisecond. Ordering the
-- history by (createdAt, id) could print the two rows the wrong way round, so the
-- running balance would no longer read continuously.
--
-- One user's rows are always written one at a time (the UPDATE on "User" holds the
-- row lock until commit), so a sequence gives exactly the order of the balance.
-- ============================================================================

-- DropIndex
DROP INDEX "PointTransaction_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "PointTransaction" ADD COLUMN     "sequence" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "PointTransaction_userId_sequence_idx" ON "PointTransaction"("userId", "sequence");
