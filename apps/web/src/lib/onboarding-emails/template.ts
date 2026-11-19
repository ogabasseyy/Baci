import { escapeHtmlAttribute as escapeEmailText } from '@/lib/sanitize';
import type { OnboardingDecision, OnboardingStage } from './policy';

const copy: Record<
  OnboardingStage,
  { eyebrow: string; heading: string; introduction: string; note: string }
> = {
  welcome: {
    eyebrow: 'WELCOME TO BACI',
    heading: 'Your next chapter starts here.',
    introduction:
      'Your Baci workspace is yours. Let’s turn it into a store your customers can explore, shop, and come back to.',
    note: 'Start with the next step below. You can save your progress and finish at your own pace.',
  },
  day1: {
    eyebrow: 'BRING YOUR STORE TO LIFE',
    heading: 'Make room for your first product.',
    introduction:
      'Every store starts with something worth sharing. Add your first product so customers can see what you have to offer.',
    note: 'A clear photo, a useful description, and a price are a good place to start.',
  },
  day3: {
    eyebrow: 'YOUR STORE, TAKING SHAPE',
    heading: 'Pick up where you left off.',
    introduction:
      'Your store setup is waiting for you. Here’s the next thing to work on before you share it with customers.',
    note: 'Take it one step at a time. Your dashboard will guide you through what’s left.',
  },
  day5: {
    eyebrow: 'THE NEXT CHAPTER',
    heading: 'Give your store a final look.',
    introduction:
      'You’ve worked on your setup. Open your dashboard to preview your store and check the details before publishing.',
    note: 'Check your products, store details, and checkout settings before you share your link.',
  },
  day7: {
    eyebrow: 'WE’RE HERE TO HELP',
    heading: 'A little help goes a long way.',
    introduction:
      'If something is holding up your store setup, you don’t have to figure it out alone. Reply and tell us where you’re stuck.',
    note: 'You can also return to your dashboard whenever you’re ready to continue.',
  },
};

export function buildOnboardingEmail(input: {
  businessName: string;
  decision: Extract<OnboardingDecision, { kind: 'send' }>;
  stage: OnboardingStage;
  appUrl: string;
  optOutUrl: string;
}) {
  const { businessName, decision, stage, optOutUrl, appUrl } = input;
  const content = copy[stage];
  const subject =
    stage === 'welcome'
      ? 'Welcome to Baci — let’s set up your store'
      : stage === 'day7'
        ? 'Need help finishing your Baci setup?'
        : `Your next Baci setup step: ${decision.action}`;
  const href = new URL(decision.href, appUrl).toString();
  const safeHref = escapeEmailText(href);
  const logoUrl = escapeEmailText(
    new URL('/baci-logo-email.png', appUrl).toString()
  );
  const safeAction = escapeEmailText(decision.action);
  const preheader = `${content.introduction} Your next step: ${decision.action}.`;
  const textContent = `Hi ${businessName},\n\n${content.heading}\n\n${content.introduction}\n\n${content.note}\n\nYOUR NEXT STEP\n${decision.action}: ${href}\n\nNeed a hand? Reply to this email or contact support@usebaci.com.\n\nThe Baci team\nYou’re receiving this email to help you set up your Baci store.\nStop setup reminders: ${optOutUrl}`;

  // Inline styles and presentation tables keep the core design intact when a
  // mailbox strips the optional mobile stylesheet. The logo has explicit
  // dimensions and alt text for mailboxes that block remote images.
  const htmlContent = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeEmailText(subject)}</title>
<style>
body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
a:focus { outline: 2px solid #f6a623; outline-offset: 3px; }
@media screen and (max-width: 600px) {
  .outer { padding: 20px 12px !important; }
  .content { padding: 30px 24px !important; }
  .headline { font-size: 34px !important; line-height: 40px !important; }
}
</style>
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: #f4f3ef; color: #252641; font-family: Arial, Helvetica, sans-serif;">
<div style="display: none; font-size: 1px; line-height: 1px; color: #f4f3ef; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${escapeEmailText(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f3ef">
<tr><td class="outer" align="center" style="padding: 40px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 600px;">
<tr><td style="padding: 0 8px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td><img src="${logoUrl}" alt="Baci" width="128" height="39" style="display: block; width: 128px; height: 39px; border: 0; color: #2a2c6e; font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: 700;"></td>
<td align="right" style="font-size: 12px; line-height: 18px; color: #686878;">YOUR BUSINESS.<br>YOUR WAY.</td>
</tr></table>
</td></tr>
<tr><td style="height: 5px; background-color: #f6a623; font-size: 0; line-height: 0;" bgcolor="#f6a623">&nbsp;</td></tr>
<tr><td class="content" bgcolor="#ffffff" style="padding: 44px 40px; background-color: #ffffff; border: 1px solid #e6e4df; border-top: 0; border-radius: 0 0 12px 12px;">
<p style="margin: 0 0 20px; color: #686878; font-size: 11px; font-weight: 700; line-height: 16px; letter-spacing: 2px;">${escapeEmailText(content.eyebrow)}</p>
<h1 class="headline" style="margin: 0 0 28px; font-family: Georgia, 'Times New Roman', serif; font-size: 42px; font-weight: 400; line-height: 48px; letter-spacing: -1px; color: #2a2c6e;">${escapeEmailText(content.heading)}</h1>
<p style="margin: 0 0 16px; font-size: 16px; line-height: 26px; overflow-wrap: anywhere; word-break: break-word;">Hi ${escapeEmailText(businessName)},</p>
<p style="margin: 0 0 16px; font-size: 16px; line-height: 26px; color: #505163;">${escapeEmailText(content.introduction)}</p>
<p style="margin: 0 0 28px; font-size: 16px; line-height: 26px; color: #505163;">${escapeEmailText(content.note)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f6f6fa" style="background-color: #f6f6fa; border: 1px solid #e5e5ee; border-radius: 8px;">
<tr><td style="padding: 22px 24px;">
<p style="margin: 0 0 10px; font-size: 11px; line-height: 16px; letter-spacing: 1.5px; font-weight: 700; color: #686878;">YOUR NEXT STEP</p>
<p style="margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; color: #2a2c6e; overflow-wrap: anywhere;">${safeAction}</p>
</td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding: 24px 0 32px;">
<!--[if mso]><v:roundrect href="${safeHref}" style="height: 52px; v-text-anchor: middle; width: 480px;" arcsize="12%" stroke="f" fillcolor="#2a2c6e"><w:anchorlock/><center style="color: #ffffff; font-family: Arial, sans-serif; font-size: 16px; font-weight: bold;">${safeAction}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a data-onboarding-action href="${safeHref}" style="display: block; padding: 16px 20px; background-color: #2a2c6e; border: 1px solid #2a2c6e; border-radius: 6px; color: #ffffff; font-size: 16px; font-weight: 700; line-height: 24px; text-align: center; text-decoration: none; overflow-wrap: anywhere;">${safeAction}&nbsp; &rarr;</a><!--<![endif]-->
</td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top: 1px solid #e8e7ed;"><tr><td style="padding-top: 24px;">
<p style="margin: 0 0 8px; font-size: 15px; line-height: 24px; font-weight: 700; color: #252641;">A real team, one reply away.</p>
<p style="margin: 0 0 24px; font-size: 14px; line-height: 23px; color: #686878;">Need a hand? Reply to this email or reach us at <a href="mailto:support@usebaci.com" style="color: #2a2c6e; text-decoration: underline;">support@usebaci.com</a>.</p>
<p style="margin: 0; font-size: 14px; line-height: 23px; color: #505163;">Here’s to what you’re building,<br><strong style="color: #2a2c6e;">The Baci team</strong></p>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding: 24px 24px 0;">
<p style="margin: 0 0 10px; font-size: 12px; line-height: 20px; color: #686878;">You’re receiving this email to help you set up your Baci store.</p>
<p style="margin: 0; font-size: 12px; line-height: 20px;"><a href="${escapeEmailText(optOutUrl)}" style="color: #686878; text-decoration: underline;">Stop setup reminders</a></p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
  return { subject, textContent, htmlContent };
}
