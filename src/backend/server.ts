import "dotenv/config";
// @ts-ignore
import express, { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { connectToDatabase, disconnectFromDatabase } from "./db";
import { UserModel } from "./models/user.model";
import { ApiError, ApiSuccess, UserInput, isUserInput, looksLikeEmail } from "./types/user";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.status(200).send("OK"));

app.post(
    "/api/users",
    async (req: Request<{}, {}, UserInput>, res: Response<ApiSuccess | ApiError>) => {
        const body = req.body;
        if (!isUserInput(body)) return res.status(400).json({ error: "Invalid body: 'name' and 'email' must be strings." });
        if (!looksLikeEmail(body.email)) return res.status(400).json({ error: "Please provide a valid email address." });

        try {
            const created = await UserModel.create({ name: body.name, email: body.email });
            const { _id, name, email } = created.toObject();
            return res.status(201).location(`/api/users/${_id}`).json({ message: "User created.", user: { name, email } });
        } catch (err: any) {
            if (err?.code === 11000) return res.status(409).json({ error: "Email already exists." });
            if (err instanceof mongoose.Error.ValidationError) return res.status(400).json({ error: err.message });
            throw err; // Express 5 will route this to error middleware
        }
    }
);

app.get("/api/users", async (_req, res) => {
    const users = await UserModel.find().select("name email createdAt").lean();
    res.status(200).json(users);
});

app.use((err: unknown, _req: Request, res: Response<ApiError>, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
});

const PORT = Number(process.env.PORT || 3000);

async function start() {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error("Missing MONGO_URI in .env");

    await connectToDatabase(uri);
    await UserModel.init(); // ensure indexes after connection

    app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

    const shutdown = async () => {
        console.log("\nShutting down...");
        await disconnectFromDatabase();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

start();
