// utils/timeUtils.js - Time formatting and calculations

/**
 * Standardize time format to "HH:MM am/pm"
 * @param {string} timeString - Time string to standardize
 * @returns {string} - Standardized time string
 */
function standardizeTimeFormat(timeString) {
    if (!timeString) return '';
    
    // First standardize the format
    let standardized = timeString
        .toLowerCase()
        .replace(/\./g, ':')       // Replace dots with colons
        .replace(/\s+/g, ' ')      // Replace multiple spaces with single space
        .replace(/(\d+):(\d+)\s*([ap])[.\s]*m\.*/i, '$1:$2 $3m') // Standardize AM/PM format
        .trim();                   // Remove leading/trailing spaces
    
    // Now ensure hours AND minutes are padded to 2 digits
    const timeParts = standardized.match(/(\d+):(\d+)\s*([ap]m)/);
    if (timeParts) {
        const hours = timeParts[1].padStart(2, '0');
        const minutes = timeParts[2].padStart(2, '0'); // Also pad minutes!
        const period = timeParts[3];
        standardized = `${hours}:${minutes} ${period}`;
    }
    
    return standardized;
}

/**
 * Get current time in IST (12-hour format)
 * @returns {string} - Current time in IST
 */
function getCurrentTimeIST() {
    const now = new Date();
    const rawTime = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).format(now).toLowerCase().trim();
    
    // Apply the same standardization for consistency
    return standardizeTimeFormat(rawTime);
}

/**
 * Generate reminder times based on a base time and frequency
 * @param {string} baseTime - Base time for the reminder (e.g., "8:00 am")
 * @param {string} frequency - Frequency description (e.g., "twice daily")
 * @returns {Array<string>} - Array of reminder times
 */
function generateReminderTimes(baseTime, frequency) {
    // First standardize the base time to ensure consistent format
    const standardizedBaseTime = standardizeTimeFormat(baseTime);
    const reminderTimes = [standardizedBaseTime];
    
    // Format: "HH:MM am/pm"
    const timeParts = standardizedBaseTime.match(/(\d+):(\d+)\s*([ap]m)/);
    if (!timeParts) return reminderTimes;
    
    let hour = parseInt(timeParts[1]);
    const minute = parseInt(timeParts[2]);
    const period = timeParts[3]; // am or pm
    
    // Convert to 24-hour format
    if (period === 'pm' && hour < 12) {
        hour += 12;
    } else if (period === 'am' && hour === 12) {
        hour = 0;
    }
    
    // Parse the frequency to determine how many times per day
    let timesPerDay = 1; // Default to once daily
    
    if (frequency === "daily" || frequency === "once daily" || frequency === "once a day") {
        timesPerDay = 1;
    } else if (frequency === "twice daily" || frequency === "daily twice" || frequency === "twice a day") {
        timesPerDay = 2;
    } else if (frequency === "thrice daily" || frequency === "daily thrice" || frequency === "three times a day") {
        timesPerDay = 3;
    } else if (frequency === "every 6 hours" || frequency === "6 hourly") {
        timesPerDay = 4;
    } else {
        // Try to parse a numerical frequency (e.g. "4 times a day")
        const numMatch = frequency.match(/(\d+)\s*times/i);
        if (numMatch && !isNaN(parseInt(numMatch[1]))) {
            timesPerDay = parseInt(numMatch[1]);
        }
    }
    
    // If frequency is just once daily, return the original time
    if (timesPerDay === 1) {
        return reminderTimes;
    }
    
    // Calculate the interval between doses (in hours)
    const hoursInterval = 24 / timesPerDay;
    
    // Generate reminder times at equal intervals
    for (let i = 1; i < timesPerDay; i++) {
        let newHour = (hour + (i * hoursInterval)) % 24;
        let newPeriod = newHour >= 12 ? 'pm' : 'am';
        
        // Convert back to 12-hour format
        if (newHour === 0) {
            newHour = 12;
            newPeriod = 'am';
        } else if (newHour > 12) {
            newHour -= 12;
            newPeriod = 'pm';
        }
        
        // Ensure hours and minutes have proper zero padding
        const paddedHour = newHour.toString().padStart(2, '0');
        const paddedMinute = minute.toString().padStart(2, '0');
        
        reminderTimes.push(`${paddedHour}:${paddedMinute} ${newPeriod}`);
    }
    
    return reminderTimes;
}



/**
 * Format a date as "DD MMM YYYY" (e.g., "25 Jan 2025")
 * @param {string|Date} dateString - Date to format
 * @returns {string} - Formatted date string
 */
function formatDate(dateString) {
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-GB', options);
}

/**
 * Calculate end date based on duration
 * @param {string|number} duration - Duration in days or "ongoing"
 * @returns {string|null} - ISO date string or null for ongoing
 */
function calculateEndDate(duration) {
    if (!duration || duration.toLowerCase() === 'ongoing') {
        return null;
    }
    
    if (!isNaN(parseInt(duration))) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + parseInt(duration));
        return endDate.toISOString();
    }
    
    return null;
}

module.exports = {
    standardizeTimeFormat,
    generateReminderTimes,
    getCurrentTimeIST,
    formatDate,
    calculateEndDate
};