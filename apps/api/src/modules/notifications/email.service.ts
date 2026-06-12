import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress = 'TraceGraph Alerts <alerts@tracegraph.io>';

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    if (!key) this.logger.warn('RESEND_API_KEY not set — email notifications disabled');
  }

  async sendAlertDigest(toEmail: string, alerts: any[]): Promise<void> {
    if (!this.resend || !toEmail || alerts.length === 0) return;

    const critical = alerts.filter((a) => a.severity === 'CRITICAL');
    const high = alerts.filter((a) => a.severity === 'HIGH');
    const subject = critical.length > 0
      ? `⚠️ ${critical.length} critical alert${critical.length > 1 ? 's' : ''} on your watchlist`
      : `${alerts.length} new alert${alerts.length > 1 ? 's' : ''} on your monitored companies`;

    const html = this.buildDigestHtml(alerts);

    try {
      await this.resend.emails.send({ from: this.fromAddress, to: toEmail, subject, html });
      this.logger.log(`Alert digest sent to ${toEmail}: ${alerts.length} alerts`);
    } catch (e: any) {
      this.logger.warn(`Failed to send email to ${toEmail}: ${e?.message}`);
    }
  }

  async sendImmediateAlert(toEmail: string, alert: any, investigationId: string): Promise<void> {
    if (!this.resend || !toEmail) return;

    const subject = `🚨 ${alert.severity}: ${alert.title} — ${alert.companyName}`;
    const html = this.buildAlertHtml(alert, investigationId);

    try {
      await this.resend.emails.send({ from: this.fromAddress, to: toEmail, subject, html });
    } catch (e: any) {
      this.logger.warn(`Failed to send immediate alert email: ${e?.message}`);
    }
  }

  private buildDigestHtml(alerts: any[]): string {
    const rows = alerts.slice(0, 20).map((a) => `
      <tr style="border-bottom:1px solid #1e293b">
        <td style="padding:12px 0">
          <span style="font-size:10px;font-family:monospace;background:${this.sevBg(a.severity)};color:${this.sevColor(a.severity)};padding:2px 6px;border-radius:3px">${a.severity}</span>
        </td>
        <td style="padding:12px 8px">
          <strong style="color:#f8fafc;font-size:13px">${a.companyName}</strong><br>
          <span style="color:#94a3b8;font-size:12px">${a.title}</span>
        </td>
        <td style="padding:12px 0;text-align:right">
          <a href="${process.env.APP_URL || 'http://localhost:3000'}/investigate/${a.metadata?.investigationId || ''}/overview" style="color:#d4ff00;font-size:11px;font-family:monospace">View →</a>
        </td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;max-width:600px;margin:0 auto">
        <div style="margin-bottom:24px">
          <span style="font-size:11px;font-family:monospace;color:#475569;letter-spacing:0.1em">TRACEGRAPH · WATCHLIST ALERT</span>
          <h1 style="margin:8px 0 4px;font-size:20px;color:#f8fafc">${alerts.length} new alert${alerts.length > 1 ? 's' : ''} on your monitored companies</h1>
          <p style="color:#64748b;font-size:13px;margin:0">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <table style="width:100%;border-collapse:collapse">
          ${rows}
        </table>
        <div style="margin-top:24px;padding-top:24px;border-top:1px solid #1e293b">
          <a href="${process.env.APP_URL || 'http://localhost:3000'}/alerts" style="display:inline-block;background:#f8fafc;color:#0f172a;padding:10px 20px;font-size:12px;font-weight:600;text-decoration:none">View all alerts</a>
        </div>
        <p style="margin-top:24px;font-size:10px;font-family:monospace;color:#334155">You're receiving this because you have companies on your TraceGraph watchlist.</p>
      </body>
      </html>
    `;
  }

  private buildAlertHtml(alert: any, investigationId: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;max-width:600px;margin:0 auto">
        <span style="font-size:10px;font-family:monospace;color:#475569">TRACEGRAPH · IMMEDIATE ALERT</span>
        <h1 style="font-size:20px;margin:8px 0;color:${this.sevColor(alert.severity)}">${alert.severity}: ${alert.title}</h1>
        <p style="color:#94a3b8;font-size:13px">${alert.companyName}</p>
        <p style="color:#cbd5e1;font-size:14px;line-height:1.6">${alert.description}</p>
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/investigate/${investigationId}/overview" style="display:inline-block;margin-top:16px;background:#f8fafc;color:#0f172a;padding:10px 20px;font-size:12px;font-weight:600;text-decoration:none">View investigation →</a>
      </body>
      </html>
    `;
  }

  private sevColor(sev: string): string {
    return sev === 'CRITICAL' ? '#ef4444' : sev === 'HIGH' ? '#f97316' : '#eab308';
  }

  private sevBg(sev: string): string {
    return sev === 'CRITICAL' ? '#450a0a' : sev === 'HIGH' ? '#431407' : '#422006';
  }
}
