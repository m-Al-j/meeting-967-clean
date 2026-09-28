import { DateTime } from 'luxon';
import { AppError } from '../core/errors/AppError.js';

export function parseLocalDateTime(value, zone = 'Asia/Riyadh') {
  const dt = DateTime.fromFormat(value.trim(), 'yyyy-MM-dd HH:mm', { zone });
  if (!dt.isValid) throw new AppError('INVALID_DATE', 'اكتب الموعد بهذه الصيغة: 2026-08-21 21:30');
  return dt.toUTC().toJSDate();
}
export function formatDate(value, zone = 'Asia/Riyadh') {
  if (!value) return '—';
  return DateTime.fromJSDate(new Date(value)).setZone(zone).toFormat('yyyy-MM-dd HH:mm');
}
