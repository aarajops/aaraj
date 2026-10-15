import { Module } from "@nestjs/common";
import { R2Storage } from "./r2-storage.js";

@Module({ providers: [R2Storage], exports: [R2Storage] })
export class StorageModule {}
