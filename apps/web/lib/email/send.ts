export interface EmailMessage {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

/**
 * Dev: writes the email to console. A real provider (Resend, SES, Postmark)
 * plugs in via this same interface in a later plan. Returning a Promise that
 * resolves keeps tests fast and deterministic.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  console.log("--- email ---");
  console.log("to:", msg.to);
  console.log("subject:", msg.subject);
  console.log(msg.textBody);
  console.log("-------------");
}
