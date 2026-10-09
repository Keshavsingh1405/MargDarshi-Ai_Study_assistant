/**
 * Margdarshi Date Utilities
 * Ensures consistent date-only operations, preventing UTC-to-local timezone rollback bugs.
 */

/**
 * Parse a date string (YYYY-MM-DD, ISO, or Date object) into a local calendar midnight Date object.
 * Avoids UTC-to-local 1-day rollback.
 * @param {string|Date} dateInput
 * @returns {Date|null}
 */
export function parseDateOnly(dateInput) {
    if (!dateInput) return null;
    if (dateInput instanceof Date) {
        if (isNaN(dateInput.getTime())) return null;
        return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate(), 0, 0, 0, 0);
    }
    const str = String(dateInput).trim();
    // 1. If exact date-only string "YYYY-MM-DD" without time or timezone
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
        const [year, month, day] = str.split('-').map(Number);
        const d = new Date(year, month - 1, day, 0, 0, 0, 0);
        if (isNaN(d.getTime())) return null;
        return d;
    }
    // 2. If ISO string (e.g. 2026-10-14T18:30:00.000Z or 2026-10-15T00:00:00.000Z) or other format,
    // let Date parse it into local time, then normalize to local midnight
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Format a Date object to 'YYYY-MM-DD' using local date components.
 * @param {Date} d
 * @returns {string}
 */
export function formatDateOnly(d) {
    if (!d || isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format date for friendly UI display, e.g. "14 Oct 2026"
 * @param {Date|string} dateInput
 * @returns {string}
 */
export function formatFriendlyDate(dateInput) {
    const d = parseDateOnly(dateInput);
    if (!d) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Calculate preparation date schedule dynamically.
 * @param {string|Date} examDateInput - The date of the exam
 * @param {string|Date} [currentDateInput] - Optional override for 'today' (defaults to local now)
 * @param {boolean} [includeExamDay=false] - Whether to include exam day as a study day
 * @returns {{
 *   today: Date,
 *   todayString: string,
 *   examDate: Date,
 *   examDateString: string,
 *   startDate: Date,
 *   startDateString: string,
 *   endDate: Date,
 *   endDateString: string,
 *   totalPrepDays: number,
 *   daysUntilExam: number,
 *   includeExamDay: boolean,
 *   prepDates: Array<{ dayNumber: number, date: Date, dateString: string, isToday: boolean, isExamDay: boolean }>
 * }}
 */
export function calculatePreparationWindow(examDateInput, currentDateInput = null, includeExamDay = false) {
    const today = currentDateInput ? parseDateOnly(currentDateInput) : parseDateOnly(new Date());
    const examDate = parseDateOnly(examDateInput);

    if (!today || isNaN(today.getTime())) {
        throw new Error('Invalid current date reference.');
    }
    if (!examDate || isNaN(examDate.getTime())) {
        throw new Error('Please provide a valid exam date.');
    }

    // Difference in calendar days
    const diffMs = examDate.getTime() - today.getTime();
    const daysUntilExam = Math.round(diffMs / 86400000);

    if (daysUntilExam < 1) {
        throw new Error('Exam date must be in the future. Please select a date at least 1 day ahead to allow for study preparation.');
    }

    // By default, study tasks end the day before the exam
    // Unless includeExamDay is requested
    const totalPrepDays = includeExamDay ? (daysUntilExam + 1) : daysUntilExam;

    const startDate = new Date(today.getTime());
    const endDate = new Date(today.getTime() + (totalPrepDays - 1) * 86400000);

    const prepDates = [];
    for (let i = 0; i < totalPrepDays; i++) {
        const curDate = new Date(startDate.getTime() + i * 86400000);
        const curDateStr = formatDateOnly(curDate);
        prepDates.push({
            dayNumber: i + 1,
            date: curDate,
            dateString: curDateStr,
            isToday: i === 0,
            isExamDay: curDateStr === formatDateOnly(examDate)
        });
    }

    return {
        today,
        todayString: formatDateOnly(today),
        examDate,
        examDateString: formatDateOnly(examDate),
        startDate,
        startDateString: formatDateOnly(startDate),
        endDate,
        endDateString: formatDateOnly(endDate),
        totalPrepDays,
        daysUntilExam,
        includeExamDay: Boolean(includeExamDay),
        prepDates
    };
}
