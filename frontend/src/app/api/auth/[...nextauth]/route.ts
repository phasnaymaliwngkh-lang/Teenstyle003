/**
 * Auth.js route handler — จัดการทุก path ใต้ /api/auth/*
 *
 * รวมถึง callback ของ Google ที่ต้องตั้งใน Google Cloud Console:
 *   http://localhost:3000/api/auth/callback/google
 *
 * ดูวิธีตั้งค่าที่ docs/04-google-oauth-setup.md
 */
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
