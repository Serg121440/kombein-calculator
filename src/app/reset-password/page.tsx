"use client";

import Link from "next/link";
import { useState } from "react";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // В MVP реального email нет — показываем подтверждение
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-brand-600 text-white grid place-items-center text-2xl font-bold">
            K
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Восстановление пароля
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Введите email от вашего аккаунта
          </p>
        </div>

        {sent ? (
          <div className="card p-6 text-center space-y-4">
            <div className="text-4xl">✉️</div>
            <div className="font-medium">Письмо отправлено</div>
            <p className="text-sm text-gray-600">
              Если аккаунт с адресом{" "}
              <span className="font-medium">{email}</span> существует, на него
              придёт ссылка для сброса пароля.
            </p>
            <p className="text-xs text-gray-400">
              В MVP отправка email недоступна — используйте данные,
              указанные при регистрации.
            </p>
            <Link href="/login" className="btn-primary inline-flex">
              Вернуться к входу
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card p-6 space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              Отправить инструкцию
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-gray-600">
          <Link href="/login" className="text-brand-600 hover:underline">
            ← Вернуться к входу
          </Link>
        </p>
      </div>
    </div>
  );
}
