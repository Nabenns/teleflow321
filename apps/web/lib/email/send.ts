export interface EmailMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

/**
 * Dev: writes the email (including verification/invite URLs) to the console so
 * the flow is testable without a real provider. A real provider (Resend, SES,
 * Postmark) plugs in via this same interface in a later plan. Returning a
 * Promise that resolves keeps tests fast and deterministic.
 *
 * The body carries secret token URLs, so we ONLY console-log in development.
 * In test we stay silent; in production we refuse to log the body (which would
 * leak the token to stdout) and instead warn that no provider is wired up.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    // No real email provider configured yet (deferred to a later plan).
    // Never log the body here — it contains a one-time secret URL.
    console.warn(
      `[email] no provider configured; dropped message to ${msg.to} (subject: ${msg.subject})`,
    );
    return;
  }
  if (process.env.NODE_ENV === "test") return;
  console.log("--- email ---");
  console.log("to:", msg.to);
  console.log("subject:", msg.subject);
  console.log(msg.textBody);
  console.log("-------------");
}
