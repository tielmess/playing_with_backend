// src/backend/app.ts
import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import mongoose from "mongoose";

// ---- Your existing types/helpers ----
import {
    ApiError,
    ApiSuccess,
    UserInput,
    isUserInput,
    looksLikeEmail
} from "./types/user";

// ⬇️ Adjust this import path if your model lives elsewhere
import { UserModel } from "./models/user.model";

dotenv.config();

const app = express();
const isDev = process.env.NODE_ENV !== "production";

// ---------- Core middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- Static hosting (/public at project root) ----------
function resolvePublicDir(): string {
    const candidates = [
        path.resolve(process.cwd(), "public"),        // run from project root
        path.resolve(__dirname, "../../public"),      // dist/backend/app.js -> ../../public
        path.resolve(__dirname, "../public"),         // ts-node-dev on src/backend
        path.resolve(process.cwd(), "dist/public")    // if copied on build
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
    return path.resolve(process.cwd(), "public");
}
const publicDir = resolvePublicDir();

app.use(
    express.static(publicDir, {
        index: "index.html",
        extensions: ["html"],
        etag: true,
        maxAge: "1h"
    })
);
app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// ---------- Utilities ----------
function routeFail(res: Response, err: unknown, label: string) {
    console.error(`${label} error:`, err);
    const safe = isDev
        ? { error: "Internal Server Error", detail: String(err) }
        : { error: "Internal Server Error" };
    return res.status(500).json(safe);
}

function requireDbReady(_req: Request, res: Response, next: NextFunction) {
    // 1 === connected
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: "Database not connected" });
    }
    next();
}

// ---------- Health ----------
app.get("/health", (_req, res) => res.status(200).send("OK"));

// ---------- API: Users (CRUD) ----------

// List (paged + search)
app.get("/api/users/paged", requireDbReady, async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page ?? 1));
        const limit = Math.min(Math.max(1, Number(req.query.limit ?? 5)), 100);
        const sortBy = String(req.query.sortBy ?? "createdAt");
        const order = String(req.query.order ?? "desc").toLowerCase() === "asc" ? 1 : -1;
        const q = (String(req.query.q ?? "")).trim();
        const email = (String(req.query.email ?? "")).trim().toLowerCase();

        const allowed = new Set(["name", "email", "createdAt", "updatedAt"]);
        if (!allowed.has(sortBy)) return res.status(400).json({ error: "Invalid sortBy" });

        const filter: Record<string, unknown> =
            email
                ? { email }
                : q
                    ? { $or: [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }] }
                    : {};

        const skip = (page - 1) * limit;

        const [rows, total] = await Promise.all([
            UserModel.find(filter)
                .select("name email createdAt")
                .sort({ [sortBy]: order })
                .skip(skip)
                .limit(limit)
                .lean(),
            UserModel.countDocuments(filter)
        ]);

        const totalPages = Math.max(1, Math.ceil(total / limit));
        return res.json({
            data: rows.map((u) => ({
                _id: u._id,
                name: u.name,
                email: u.email,
                createdAt: u.createdAt
            })),
            meta: {
                page,
                limit,
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                sortBy,
                order: order === 1 ? "asc" : "desc"
            }
        });
    } catch (err) {
        return routeFail(res, err, "GET /api/users/paged");
    }
});

// Get by id
app.get(
    "/api/users/:id",
    requireDbReady,
    async (req: Request<{ id: string }>, res: Response<ApiSuccess | ApiError>) => {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) {
                return res.status(400).json({ error: "Invalid user id." });
            }

            const user = await UserModel.findById(id).select("name email createdAt").lean();
            if (!user) return res.status(404).json({ error: "User not found." });

            // @ts-ignore
            // @ts-ignore
            // @ts-ignore
            // @ts-ignore
            return res.status(200).json({
                message: "User found.",
                user: {
                    name: user.name,
                    email: user.email,
                    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : undefined
                }
            });
        } catch (err) {
            return routeFail(res, err, "GET /api/users/:id");
        }
    }
);

// Create
app.post(
    "/api/users",
    requireDbReady,
    async (req: Request<{}, ApiSuccess | ApiError, UserInput>, res: Response<ApiSuccess | ApiError>) => {
        try {
            const body = req.body;
            if (!isUserInput(body)) {
                return res
                    .status(400)
                    .json({ error: "Invalid body: 'name' and 'email' must be strings." });
            }
            if (!looksLikeEmail(body.email)) {
                return res.status(400).json({ error: "Please provide a valid email address." });
            }

            const name = body.name.trim();
            const email = body.email.trim().toLowerCase();

            const doc = await UserModel.create({ name, email });
            res.setHeader("Location", `/api/users/${doc._id.toString()}`);

            return res.status(201).json({
                message: "User created.",
                user: { name: doc.name, email: doc.email }
            });
        } catch (err: any) {
            if (err && (err.code === 11000 || err?.name === "MongoServerError")) {
                return res.status(409).json({ error: "Email already exists." });
            }
            return routeFail(res, err, "POST /api/users");
        }
    }
);

// Update (partial: name/email)
app.put(
    "/api/users/:id",
    requireDbReady,
    async (
        req: Request<{ id: string }, ApiSuccess | ApiError, Partial<UserInput>>,
        res: Response<ApiSuccess | ApiError>
    ) => {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) {
                return res.status(400).json({ error: "Invalid user id." });
            }

            const { name, email } = req.body ?? {};
            if (name === undefined && email === undefined) {
                return res.status(400).json({ error: "Provide at least one of: name, email." });
            }
            if (name !== undefined && typeof name !== "string") {
                return res.status(400).json({ error: "Field 'name' must be a string." });
            }
            if (email !== undefined) {
                if (typeof email !== "string") {
                    return res.status(400).json({ error: "Field 'email' must be a string." });
                }
                if (!looksLikeEmail(email)) {
                    return res.status(400).json({ error: "Please provide a valid email address." });
                }
            }

            const update: Record<string, any> = {};
            if (name !== undefined) update.name = name.trim();
            if (email !== undefined) update.email = email.trim().toLowerCase();

            const doc = await UserModel.findByIdAndUpdate(
                id,
                { $set: update },
                { new: true, runValidators: true }
            ).select("name email");

            if (!doc) return res.status(404).json({ error: "User not found." });

            return res.status(200).json({
                message: "User updated.",
                user: { name: doc.name, email: doc.email }
            });
        } catch (err: any) {
            if (err && (err.code === 11000 || err?.name === "MongoServerError")) {
                return res.status(409).json({ error: "Email already exists." });
            }
            return routeFail(res, err, "PUT /api/users/:id");
        }
    }
);

// Delete
app.delete(
    "/api/users/:id",
    requireDbReady,
    async (req: Request<{ id: string }>, res: Response) => {
        try {
            const { id } = req.params;
            if (!mongoose.isValidObjectId(id)) {
                return res.status(400).json({ error: "Invalid user id." });
            }

            const result = await UserModel.findByIdAndDelete(id).lean();
            if (!result) return res.status(404).json({ error: "User not found." });

            return res.status(204).send();
        } catch (err) {
            return routeFail(res, err, "DELETE /api/users/:id");
        }
    }
);

// ---------- Final error handler ----------
app.use((err: unknown, _req: Request, res: Response<ApiError>, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
});

// ---------- Startup: connect DB first, then listen ----------
const PORT = Number(process.env.PORT || 3000);
const uri = process.env.MONGODB_URI;

async function start() {
    if (!uri) {
        console.error("Missing MONGODB_URI in .env");
        process.exit(1);
    }

    mongoose.set("strictQuery", true);
    // Uncomment if you prefer immediate failures instead of buffering:
    // mongoose.set("bufferCommands", false);

    mongoose.connection.on("connected", () => {
        console.log(`MongoDB connected (${mongoose.connection.name})`);
    });
    mongoose.connection.on("error", (e) => {
        console.error("MongoDB connection error:", e);
    });
    mongoose.connection.on("disconnected", () => {
        console.warn("MongoDB disconnected");
    });

    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000, // surface Atlas allow-list/DNS issues fast
        family: 4                       // helps on some Windows/DNS setups
    } as any);

    // Ensure indexes (e.g., unique email)
    await UserModel.init();

    app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
        console.log(`Serving static from: ${publicDir}`);
    });
}

start().catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
});
