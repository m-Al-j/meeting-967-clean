export function deriveAttendance({ excused = false, firstJoinAt = null, scheduledAt, lateAfterMinutes = 10, totalSeconds = 0, meetingDurationSeconds = 0 }) {
  if (excused) return { status: 'excused', lateBySeconds: 0, presenceRatio: 0, fullAttendance: false };
  if (!firstJoinAt) return { status: 'absent', lateBySeconds: 0, presenceRatio: 0, fullAttendance: false };
  const lateBySeconds = Math.max(0, Math.floor((new Date(firstJoinAt) - new Date(scheduledAt)) / 1000));
  const status = lateBySeconds > lateAfterMinutes * 60 ? 'late' : 'present';
  const ratio = meetingDurationSeconds > 0 ? Math.min(1, totalSeconds / meetingDurationSeconds) : 0;
  return { status, lateBySeconds, presenceRatio: Number(ratio.toFixed(4)), fullAttendance: ratio >= 0.9 };
}
