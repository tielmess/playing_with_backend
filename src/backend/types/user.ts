// src/types/user.ts

// The shape of data we expect from the client.
export interface UserInput {
    name: string;
    email: string;
}

// A successful API response payload.
export interface ApiSuccess {
    message: string;
    user: UserInput;
}

// An error response payload.
export interface ApiError {
    error: string;
}

/**
 * Type guard: runtime check that also informs TypeScript
 * that an unknown value is actually a UserInput.
 */
export function isUserInput(value: unknown): value is UserInput {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.name === "string" && typeof v.email === "string";
}

// A short email sanity check (needs updating).
export function looksLikeEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
