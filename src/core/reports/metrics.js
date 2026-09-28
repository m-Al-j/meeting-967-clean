export function clamp01(value) {
  const n = Number(value ?? 0);
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

export function formatDuration(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function statusLabel(status) {
  return ({
    present: 'حاضر',
    late: 'متأخر',
    absent: 'غائب',
    excused: 'معتذر',
  })[status] ?? 'غير محدد';
}

export function arrivalLabel(row, scheduledAt) {
  if (!row?.first_join_at) return row?.status === 'excused' ? 'معتذر' : 'غائب';
  const diff = Math.floor((new Date(row.first_join_at) - new Date(scheduledAt)) / 1000);
  if (diff < -60) return 'مبكر';
  if (row.status === 'late') return 'متأخر';
  return 'في الموعد';
}

export function coverageLabel(row) {
  return `${Math.round(clamp01(row?.presence_ratio) * 100)}%`;
}

export function attendanceClass(row) {
  if (!row?.first_join_at) return 'none';
  const ratio = clamp01(row.presence_ratio);
  if (row.full_attendance || ratio >= 0.9) return 'full';
  if (ratio >= 0.5) return 'partial';
  return 'short';
}

export function attendanceSummary(rows = [], durationSeconds = 0, scheduledAt = null) {
  const expected = rows.length;
  const presentRows = rows.filter((r) => ['present', 'late'].includes(r.status));
  const absent = rows.filter((r) => r.status === 'absent').length;
  const excused = rows.filter((r) => r.status === 'excused').length;
  const late = rows.filter((r) => r.status === 'late').length;
  const full = rows.filter((r) => attendanceClass(r) === 'full').length;
  const partial = rows.filter((r) => attendanceClass(r) === 'partial').length;
  const short = rows.filter((r) => attendanceClass(r) === 'short').length;
  let early = 0;
  let onTime = 0;
  for (const row of presentRows) {
    const arrival = arrivalLabel(row, scheduledAt);
    if (arrival === 'مبكر') early += 1;
    else if (arrival === 'في الموعد') onTime += 1;
  }
  const joins = rows.reduce((sum, r) => sum + Number(r.join_count ?? (r.first_join_at ? 1 : 0)), 0);
  return {
    expected,
    attended: presentRows.length,
    absent,
    excused,
    attendanceRate: expected ? Math.round((presentRows.length / expected) * 100) : 0,
    short,
    partial,
    full,
    late,
    joins,
    onTime,
    early,
    durationSeconds,
  };
}

export function meetingStatusLabel(status) {
  return ({
    upcoming: 'قادم',
    ongoing: 'جاري',
    ended: 'مكتمل',
    canceled: 'ملغي',
    postponed: 'مؤجل',
  })[status] ?? status ?? 'غير محدد';
}
