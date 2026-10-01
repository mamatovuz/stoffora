import { getRandomValues } from "expo-crypto";

/*
 * Kriptografik tasodifiy sonlar: @noble/curves `crypto.getRandomValues` ni ishlatadi.
 * Hermes’da u yo‘q bo‘lishi mumkin — OS’ning xavfsiz generatori (expo-crypto) ulanadi.
 */
const g = globalThis as unknown as { crypto?: { getRandomValues?: typeof getRandomValues } };
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) g.crypto.getRandomValues = getRandomValues;
