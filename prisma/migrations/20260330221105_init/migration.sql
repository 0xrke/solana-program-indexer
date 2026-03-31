-- CreateTable
CREATE TABLE "transactions" (
    "id" SERIAL NOT NULL,
    "signature" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "block_time" TIMESTAMP(3),
    "fee" BIGINT,
    "success" BOOLEAN NOT NULL,
    "signers" TEXT[],
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructions" (
    "id" SERIAL NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "program_id" TEXT NOT NULL,
    "instruction_name" TEXT NOT NULL,
    "accounts" JSONB NOT NULL,
    "args" JSONB NOT NULL,
    "ix_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_signature_key" ON "transactions"("signature");

-- AddForeignKey
ALTER TABLE "instructions" ADD CONSTRAINT "instructions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
