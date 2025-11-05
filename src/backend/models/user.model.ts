// src/backend/models/user.model.ts
import mongoose, { Schema } from "mongoose";

const UserSchema = new Schema(
    {
        name:  { type: String, required: true, trim: true },
        email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true }
    },
    { timestamps: true } // <-- creates createdAt & updatedAt (your UI sorts/reads these)
);

export const UserModel = mongoose.model("User", UserSchema);
