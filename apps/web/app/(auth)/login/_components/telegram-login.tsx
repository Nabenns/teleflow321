"use client";
import { signIn } from "next-auth/react";
import Script from "next/script";
import { useEffect } from "react";

interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (data: TelegramAuthData) => void;
  }
}

export function TelegramLogin({ botUsername }: { botUsername: string }) {
  useEffect(() => {
    window.onTelegramAuth = async (data) => {
      const res = await signIn("telegram", {
        payload: JSON.stringify(data),
        redirect: false,
      });
      if (res?.ok) {
        window.location.href = "/new-merchant";
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, []);

  if (!botUsername) {
    return (
      <p className="text-xs text-slate-500">
        Telegram login belum dikonfigurasi (set TELEGRAM_LOGIN_BOT_USERNAME).
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login={botUsername}
        data-size="large"
        data-onauth="onTelegramAuth(user)"
        data-request-access="write"
        strategy="afterInteractive"
      />
    </>
  );
}
