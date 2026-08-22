-- Multi-gateway payments: reconciliation columns on Payment plus the webhook
-- idempotency ledger. Additive only — no existing column is dropped or
-- retyped, so a live database keeps every settled payment it already has.

ALTER TABLE "Payment" ADD COLUMN     "providerOrderId" TEXT,
                      ADD COLUMN     "providerPaymentId" TEXT,
                      ADD COLUMN     "mode" TEXT,
                      ADD COLUMN     "failureReason" TEXT,
                      ADD COLUMN     "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
                      ADD COLUMN     "paidAt" TIMESTAMP(3),
                      ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- Existing captured payments predate paidAt; backfill from the row's own
-- update time so revenue-by-paid-date reporting has no holes.
UPDATE "Payment" SET "paidAt" = "updatedAt" WHERE "status" = 'CAPTURED' AND "paidAt" IS NULL;

CREATE INDEX "Payment_providerOrderId_idx" ON "Payment"("providerOrderId");

-- A callback that arrives carrying only a merchant reference must resolve to
-- exactly one payment, so `reference` becomes unique.
--
-- Historic rows can collide: the previous confirm endpoint wrote the caller's
-- own string into `reference` when a verification failed, so several failed
-- payments may share one value. Those are cleared rather than the migration
-- failing — a reference on a payment that never settled carries no
-- reconciliation value. The settled row in each group keeps its reference.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "reference"
           ORDER BY
             CASE WHEN "status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN 0 ELSE 1 END,
             "updatedAt" DESC
         ) AS position
  FROM "Payment"
  WHERE "reference" IS NOT NULL
)
UPDATE "Payment" SET "reference" = NULL
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- One gateway payment id settles exactly one order. NULLs are not compared in
-- Postgres, so rows that never reached a gateway are unconstrained.
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key"
  ON "Payment"("provider", "providerPaymentId");

CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" TEXT,
    "result" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");
CREATE INDEX "PaymentEvent_paymentId_idx" ON "PaymentEvent"("paymentId");
CREATE INDEX "PaymentEvent_createdAt_idx" ON "PaymentEvent"("createdAt");

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
