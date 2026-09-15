-- CreateTable
CREATE TABLE "saves" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saves_player_id_key" ON "saves"("player_id");

-- AddForeignKey
ALTER TABLE "saves" ADD CONSTRAINT "saves_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
