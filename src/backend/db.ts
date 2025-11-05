// src/db.ts
import mongoose from "mongoose";

/**
 * Connect to MongoDB once at startup.
 * Mongoose manages an internal connection pool for you.
 */
export async function connectToDatabase(uri: string): Promise<void> {
    // Optional, keeps queries strict; removes deprecation warnings.
    mongoose.set("strictQuery", true);

    await mongoose.connect(uri);
    console.log("MongoDB connected");
}

/** Gracefully close DB on shutdown (CTRL+C, etc.) */
export async function disconnectFromDatabase(): Promise<void> {
    await mongoose.connection.close();
    console.log("MongoDB disconnected");
}
