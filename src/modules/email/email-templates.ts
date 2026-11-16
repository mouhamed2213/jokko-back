const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

const layout = (title: string, content: string) => `
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:28px 32px;background:#0f172a;color:#ffffff;font-size:20px;font-weight:700;">Jokko Business</td></tr>
          <tr><td style="padding:32px;line-height:1.6;">${content}</td></tr>
          <tr><td style="padding:20px 32px;background:#f8fafc;color:#64748b;font-size:12px;">Cet email a été envoyé automatiquement par Jokko Business. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer ce message.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const actionButton = (url: string, label: string) =>
  `<p style="margin:28px 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 22px;background:#059669;color:#ffffff;text-decoration:none;border-radius:9px;font-weight:700;">${escapeHtml(label)}</a></p>`;

export const emailTemplates = {
  verification: (name: string, url: string) => ({
    subject: "Confirmez votre adresse email - Jokko Business",
    text: `Bonjour ${name}, confirmez votre adresse email en ouvrant ce lien : ${url}. Ce lien expire dans 30 minutes.`,
    html: layout(
      "Confirmez votre adresse email",
      `<h1 style="font-size:22px;">Confirmez votre adresse email</h1>
      <p>Bonjour ${escapeHtml(name)},</p>
      <p>Pour sécuriser votre compte Jokko Business, confirmez que cette adresse email vous appartient.</p>
      ${actionButton(url, "Confirmer mon adresse email")}
      <p>Ce lien est valable pendant 30 minutes. Si vous n'avez pas créé de compte, ignorez cet email.</p>`,
    ),
  }),
  passwordReset: (name: string, url: string) => ({
    subject: "Réinitialisation de votre mot de passe - Jokko Business",
    text: `Bonjour ${name}, réinitialisez votre mot de passe avec ce lien : ${url}. Ce lien expire dans 30 minutes.`,
    html: layout(
      "Réinitialisation du mot de passe",
      `<h1 style="font-size:22px;">Réinitialisation du mot de passe</h1>
      <p>Bonjour ${escapeHtml(name)},</p>
      <p>Une demande de réinitialisation du mot de passe a été effectuée pour votre compte.</p>
      ${actionButton(url, "Choisir un nouveau mot de passe")}
      <p>Ce lien est valable pendant 30 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
    ),
  }),
  emailChange: (name: string, url: string, newEmail: string) => ({
    subject: "Confirmez votre nouvelle adresse email - Jokko Business",
    text: `Bonjour ${name}, confirmez votre nouvelle adresse ${newEmail} avec ce lien : ${url}. Ce lien expire dans 30 minutes.`,
    html: layout(
      "Confirmation de la nouvelle adresse",
      `<h1 style="font-size:22px;">Confirmez votre nouvelle adresse</h1>
      <p>Bonjour ${escapeHtml(name)},</p>
      <p>Vous avez demandé à remplacer votre adresse par <strong>${escapeHtml(newEmail)}</strong>.</p>
      ${actionButton(url, "Confirmer cette adresse")}
      <p>Votre adresse actuelle ne sera remplacée qu'après confirmation. Ce lien expire dans 30 minutes.</p>`,
    ),
  }),
  passwordChanged: (name: string) => ({
    subject: "Votre mot de passe a été modifié - Jokko Business",
    text: `Bonjour ${name}, le mot de passe de votre compte Jokko Business vient d'être modifié. Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support.`,
    html: layout(
      "Mot de passe modifié",
      `<h1 style="font-size:22px;">Mot de passe modifié</h1>
      <p>Bonjour ${escapeHtml(name)},</p>
      <p>Le mot de passe de votre compte vient d'être modifié.</p>
      <p><strong>Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support.</strong></p>`,
    ),
  }),
  emailChangeRequested: (name: string, newEmail: string) => ({
    subject: "Demande de changement d'adresse email - Jokko Business",
    text: `Bonjour ${name}, une demande de changement d'adresse email vers ${newEmail} vient d'être effectuée sur votre compte. Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement le support.`,
    html: layout(
      "Demande de changement d'adresse",
      `<h1 style="font-size:22px;">Demande de changement d'adresse</h1>
      <p>Bonjour ${escapeHtml(name)},</p>
      <p>Une demande de remplacement de votre adresse email par <strong>${escapeHtml(newEmail)}</strong> vient d'être effectuée.</p>
      <p>Votre adresse actuelle reste active tant que la nouvelle adresse n'a pas été confirmée.</p>
      <p><strong>Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement le support.</strong></p>`,
    ),
  }),
  emailChanged: (name: string, newEmail: string) => ({
    subject: "Votre adresse email a été modifiée - Jokko Business",
    text: `Bonjour ${name}, l'adresse email de votre compte vient d'être remplacée par ${newEmail}. Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support.`,
    html: layout(
      "Adresse email modifiée",
      `<h1 style="font-size:22px;">Adresse email modifiée</h1>
      <p>Bonjour ${escapeHtml(name)},</p>
      <p>L'adresse email de votre compte vient d'être remplacée par <strong>${escapeHtml(newEmail)}</strong>.</p>
      <p><strong>Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support.</strong></p>`,
    ),
  }),
};
