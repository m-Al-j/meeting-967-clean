import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const TEMPLATE = path.resolve(process.cwd(), 'assets/reports/membership-management-report-template.docx');
const PYTHON_RENDERER = path.resolve(process.cwd(), 'ops/render_membership_report_v4.py');

export async function renderMembershipManagementReport({
  outputPath,
  rows,
  stats,
  reportId,
  reportTitle = '',
  periodStart,
  periodEnd,
  issueDate,
  zone,
  notes = '',
}) {
  await fs.access(TEMPLATE);
  await fs.access(PYTHON_RENDERER);

  const payloadPath = path.join(
    path.dirname(outputPath),
    `.membership-report-${randomUUID()}.json`,
  );

  const payload = {
    template: TEMPLATE,
    rows,
    stats,
    report_id: reportId,
    report_title: reportTitle,
    period_start: periodStart,
    period_end: periodEnd,
    issue_date: issueDate,
    zone,
    notes,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.PYTHON || 'python', [PYTHON_RENDERER, payloadPath, outputPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += String(chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0) return resolve();
        reject(new Error(stderr || stdout || `membership report renderer exited with code ${code}`));
      });
    });
  } finally {
    await fs.rm(payloadPath, { force: true }).catch(() => {});
  }

  return { outputPath };
}
