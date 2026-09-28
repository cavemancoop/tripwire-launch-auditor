-- Durable edge-triggered operational alert state; additive and empty on deploy.
CREATE TABLE "alert_delivery_states" (
    "key" TEXT NOT NULL,
    "lastBad" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "alert_delivery_states_pkey" PRIMARY KEY ("key")
);
