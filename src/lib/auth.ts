"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuid } from "uuid";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface AuthState {
  user: AuthUser | null;
  sessionToken: string | null;
  sessionExpiry: string | null;

  register: (
    email: string,
    name: string,
    password: string,
  ) => { ok: true; user: AuthUser } | { ok: false; error: string };
  login: (
    email: string,
    password: string,
  ) => { ok: true; user: AuthUser } | { ok: false; error: string };
  logout: () => void;
  isAuthenticated: () => boolean;
}

interface StoredAccount {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
}

function simpleHash(password: string): string {
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = (Math.imul(31, h) + password.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function accountsKey(): string {
  return "kombein-accounts-v1";
}

function loadAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(accountsKey()) ?? "[]");
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(accountsKey(), JSON.stringify(accounts));
}

function makeToken(): string {
  return uuid();
}

const SESSION_DAYS = 7;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      sessionExpiry: null,

      register: (email, name, password) => {
        const accounts = loadAccounts();
        const normalized = email.trim().toLowerCase();
        if (!normalized || !password || !name.trim()) {
          return { ok: false, error: "Заполните все поля" };
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          return { ok: false, error: "Некорректный email" };
        }
        if (password.length < 8) {
          return { ok: false, error: "Пароль должен быть не менее 8 символов" };
        }
        if (accounts.find((a) => a.email === normalized)) {
          return {
            ok: false,
            error: "Пользователь с таким email уже зарегистрирован",
          };
        }
        const stored: StoredAccount = {
          id: uuid(),
          email: normalized,
          name: name.trim(),
          passwordHash: simpleHash(password),
          createdAt: new Date().toISOString(),
        };
        saveAccounts([...accounts, stored]);

        const user: AuthUser = {
          id: stored.id,
          email: stored.email,
          name: stored.name,
          createdAt: stored.createdAt,
        };
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + SESSION_DAYS);
        set({ user, sessionToken: makeToken(), sessionExpiry: expiry.toISOString() });
        return { ok: true, user };
      },

      login: (email, password) => {
        const normalized = email.trim().toLowerCase();
        const accounts = loadAccounts();
        const found = accounts.find(
          (a) =>
            a.email === normalized &&
            a.passwordHash === simpleHash(password),
        );
        if (!found) {
          return { ok: false, error: "Неверный email или пароль" };
        }
        const user: AuthUser = {
          id: found.id,
          email: found.email,
          name: found.name,
          createdAt: found.createdAt,
        };
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + SESSION_DAYS);
        set({ user, sessionToken: makeToken(), sessionExpiry: expiry.toISOString() });
        return { ok: true, user };
      },

      logout: () => {
        set({ user: null, sessionToken: null, sessionExpiry: null });
      },

      isAuthenticated: () => {
        const { user, sessionExpiry } = get();
        if (!user || !sessionExpiry) return false;
        return new Date(sessionExpiry).getTime() > Date.now();
      },
    }),
    {
      name: "kombein-auth-v1",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
    },
  ),
);
