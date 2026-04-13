using AttendanceBehaviour_Backend.Data;
using AttendanceBehaviour_Backend.Models;
using AttendanceBehaviour_Backend.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AttendanceBehaviour_Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class NotificationsController : ControllerBase
    {
        private readonly ElsewedySchoolContext _context;
        private readonly INotificationFileStore _store;

        private readonly IPushSubscriptionStore _pushStore;
        private readonly IPushSender _pushSender;
        private readonly IAttendanceSubmissionStore _submissionStore;

        public NotificationsController(ElsewedySchoolContext context, INotificationFileStore store, IPushSubscriptionStore pushStore, IPushSender pushSender, IAttendanceSubmissionStore submissionStore)
        {
            _context = context;
            _store = store;
            _pushStore = pushStore;
            _pushSender = pushSender;
            _submissionStore = submissionStore;
        }

        [HttpGet("debug-user/{userId:long}")]
        public async Task<IActionResult> DebugUser(long userId)
        {
            var account = await _context.Accounts.AsNoTracking()
                .Include(a => a.Role)
                .FirstOrDefaultAsync(a => a.Id == userId);
            
            var roles = await _context.Roles.AsNoTracking().ToListAsync();
            
            return Ok(new
            {
                userId,
                accountFound = account != null,
                accountInfo = account != null ? new { 
                    account.Id, 
                    account.FullNameEn, 
                    account.RoleId, 
                    RoleName = account.Role?.RoleName,
                    account.IsActive 
                } : null,
                allRoles = roles.Select(r => new { r.Id, r.RoleName }).ToList()
            });
        }

        [HttpGet("debug-roles")]
        public async Task<IActionResult> DebugRoles()
        {
            var roles = await _context.Roles.AsNoTracking().ToListAsync();
            var accountsCount = await _context.Accounts.AsNoTracking().CountAsync();
            var studentAffairAccounts = await _context.Accounts.AsNoTracking()
                .Where(a => a.Role.RoleName.ToLower().Contains("affair"))
                .Select(a => new { a.Id, a.FullNameEn, a.Email, RoleName = a.Role.RoleName })
                .ToListAsync();

            return Ok(new
            {
                roles,
                accountsCount,
                studentAffairAccounts
            });
        }

        [HttpGet("for-user/{userId:long}")]
        public async Task<IActionResult> GetForUser(long userId)
        {
            var items = await _store.GetForUserAsync(userId);
            Console.WriteLine($"[Notifications] GetForUser ID: {userId} -> Found {items.Count} items");
            return Ok(items);
        }

        public class MissingSessionsRequest
        {
            public long ClassId { get; set; }
            public int[] SelectedSessions { get; set; } = Array.Empty<int>();
            public string? Date { get; set; } // yyyy-MM-dd
        }

        [HttpPost("report-missing")]
        public async Task<IActionResult> ReportMissingSessions([FromBody] MissingSessionsRequest req)
        {
            try {
                if (req.ClassId <= 0)
                    return BadRequest("Invalid classId");

                var date = !string.IsNullOrWhiteSpace(req.Date) ? req.Date : DateTime.UtcNow.ToString("yyyy-MM-dd");

                // Mark current sessions as submitted
                if (req.SelectedSessions != null && req.SelectedSessions.Length > 0)
                {
                    await _submissionStore.MarkSessionsSubmittedAsync(req.ClassId, req.SelectedSessions, date);
                }

                var classEntity = await _context.TblClasses.AsNoTracking()
                    .FirstOrDefaultAsync(c => c.Id == req.ClassId);
                var className = classEntity?.ClassName ?? $"Class {req.ClassId}";

                // 1. Get ALL active sessions from DB
                var allSessions = await _context.Sessions.AsNoTracking()
                    .Where(s => s.StatusId == 1 && s.SessionNo != null)
                    .Select(s => s.SessionNo!.Value)
                    .Distinct()
                    .OrderBy(n => n)
                    .ToListAsync();
                
                // 2. Identify "in-between" sessions that are missing (STRICT GAPS ONLY)
                var selected = (req.SelectedSessions ?? Array.Empty<int>()).OrderBy(n => n).ToList();
                if (selected.Count < 2) {
                    return Ok(new { created = 0, message = "No in-between sessions missing" });
                }

                int min = selected.First();
                int max = selected.Last();
                var selectedSet = new HashSet<int>(selected);
                
                var missingCandidates = allSessions
                    .Where(n => n > min && n < max && !selectedSet.Contains(n))
                    .ToList();
                
                if (missingCandidates.Count == 0) {
                    return Ok(new { created = 0, message = "No in-between sessions missing" });
                }

                // New logic: Check if attendance was actually taken in those sessions (check submission store)
                var missing = new List<int>();
                foreach (var sid in missingCandidates)
                {
                    bool submitted = await _submissionStore.IsSessionSubmittedAsync(req.ClassId, sid, date);
                    if (!submitted)
                    {
                        missing.Add(sid);
                    }
                }

                if (missing.Count == 0) {
                    return Ok(new { created = 0, message = "All in-between sessions already have records" });
                }

                // 3. ONLY send to recipient ID 7800
                var recipients = new List<long>();
                if (await _context.Accounts.AnyAsync(a => a.Id == 7800)) {
                    recipients.Add(7800);
                }

                if (recipients.Count == 0) {
                    return Ok(new { created = 0, message = "Recipient 7800 not found" });
                }

                var message = $"Attendance for class {className} has not been taken for session(s): {string.Join(", ", missing)}.";
                var batch = recipients.Select(uid => new NotificationItem
                {
                    RecipientUserId = uid,
                    Message = message,
                    ClassId = req.ClassId,
                    SessionsMissing = missing,
                    Date = !string.IsNullOrWhiteSpace(req.Date) ? req.Date : DateTime.UtcNow.ToString("yyyy-MM-dd")
                }).ToList();

                await _store.AddAsync(batch);
                
                try {
                    var subs = await _pushStore.GetByUserIdsAsync(recipients);
                    if (subs.Count > 0) {
                        await _pushSender.SendAsync(subs, "Attendance Notification", message);
                    }
                } catch {}

                return Ok(new { created = batch.Count, notifications = batch });
            } catch (Exception ex) {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        public class CheckAbsentRangeRequest
        {
            public long ClassId { get; set; }
            public string? Date { get; set; } // yyyy-MM-dd
        }

        [HttpPost("check-absent-range")]
        public async Task<IActionResult> CheckAbsentRange([FromBody] CheckAbsentRangeRequest req)
        {
            try {
                if (req.ClassId <= 0) return BadRequest("Invalid classId");
                var date = !string.IsNullOrWhiteSpace(req.Date) ? req.Date : DateTime.UtcNow.ToString("yyyy-MM-dd");
                var dateOnly = DateOnly.Parse(date);

                Console.WriteLine($"[Notifications] CheckAbsentRange: Class {req.ClassId}, Date {date}");

                // Target sessions as long to match DB SessionId type
                var targetSessions = new long[] { 3, 4, 5, 6, 7, 8 };
                
                var studentAbsences = await _context.AbsenceRecords.AsNoTracking()
                    .Where(a => a.ClassId == req.ClassId && a.DateOfAbsence == dateOnly)
                    .Select(a => new { a.StudentId, a.SessionId })
                    .ToListAsync();

                var groupedByStudent = studentAbsences.GroupBy(a => a.StudentId);
                var newNotifications = new List<NotificationItem>();

                // Get existing notifications for user 7800 today to avoid duplicates
                var existingNotifs = await _store.GetForUserAsync(7800);
                var todayNotifMessages = new HashSet<string>(existingNotifs.Where(n => n.Date == date).Select(n => n.Message));

                var classEntity = await _context.TblClasses.AsNoTracking().FirstOrDefaultAsync(c => c.Id == req.ClassId);
                var className = classEntity?.ClassName ?? $"Class {req.ClassId}";

                foreach (var group in groupedByStudent)
                {
                    var studentId = group.Key;
                    var studentSessions = group
                        .Where(g => g.SessionId.HasValue)
                        .Select(g => g.SessionId!.Value)
                        .ToHashSet();

                    // Find which target sessions this student is absent in
                    var absentInTarget = targetSessions.Where(s => studentSessions.Contains(s)).ToList();
                    bool hasFullDay = studentSessions.Contains(-1L);

                    if (hasFullDay || absentInTarget.Count > 0)
                    {
                        var student = await _context.TblStudents.AsNoTracking()
                            .FirstOrDefaultAsync(s => s.StudentId == studentId);
                        var studentName = student?.StudentNameEn ?? $"Student {studentId}";

                        string message;
                        if (hasFullDay)
                        {
                            message = $"Student {studentName} in {className} was absent for the ENTIRE DAY on {date}.";
                        }
                        else
                        {
                            message = $"Student {studentName} in {className} was absent in session(s): {string.Join(", ", absentInTarget)} on {date}.";
                        }

                        // Check if we already sent this exact message today
                        if (!todayNotifMessages.Contains(message))
                        {
                            newNotifications.Add(new NotificationItem
                            {
                                RecipientUserId = 7800,
                                Message = message,
                                ClassId = req.ClassId,
                                Date = date
                            });
                        }
                    }
                }

                if (newNotifications.Count > 0)
                {
                    await _store.AddAsync(newNotifications);
                    Console.WriteLine($"[Notifications] Sending {newNotifications.Count} individual absence notifications.");

                    try {
                        var recipients = new List<long> { 7800 };
                        var subs = await _pushStore.GetByUserIdsAsync(recipients);
                        if (subs.Count > 0) 
                        {
                            foreach (var n in newNotifications)
                            {
                                await _pushSender.SendAsync(subs, "Student Absence Alert", n.Message);
                            }
                        }
                    } catch (Exception ex) {
                        Console.WriteLine($"[Notifications] Push failed: {ex.Message}");
                    }
                    
                    return Ok(new { created = newNotifications.Count, message = "Notifications sent" });
                }

                return Ok(new { message = "No new individual absences to notify" });
            } catch (Exception ex) {
                Console.WriteLine($"[Notifications] ERROR in CheckAbsentRange: {ex.Message}");
                return StatusCode(500, new { message = ex.Message });
            }
        }

        [HttpPost("mark-read/{userId:long}/{notificationId:long}")]
        public async Task<IActionResult> MarkRead(long userId, long notificationId)
        {
            await _store.MarkAsReadAsync(userId, notificationId);
            return Ok();
        }
    }
}
